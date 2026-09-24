// Pluely AI Speech Detection, and capture system audio (speaker output) as a stream of f32 samples.
use crate::speaker::{AudioDevice, SpeakerInput};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use futures_util::StreamExt;
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Listener, Manager};
use tauri_plugin_shell::ShellExt;
use tracing::{error, warn};

// VAD Configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VadConfig {
    pub enabled: bool,
    pub hop_size: usize,
    pub sensitivity_rms: f32,
    pub peak_threshold: f32,
    pub silence_chunks: usize,
    pub min_speech_chunks: usize,
    pub pre_speech_chunks: usize,
    pub noise_gate_threshold: f32,
    pub max_recording_duration_secs: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemSpeechSegment {
    sequence: u64,
    audio_base64: String,
    speech_ended_at: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CallAudioFrame {
    sample_rate: u32,
    pcm_base64: String,
}

fn emit_pcm_frame(app: &AppHandle, sample_rate: u32, samples: &[f32]) {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let value = (clamped * i16::MAX as f32) as i16;
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    let _ = app.emit(
        "call-system-audio-frame",
        CallAudioFrame {
            sample_rate,
            pcm_base64: B64.encode(bytes),
        },
    );
}

fn wall_clock_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn emit_speech_segment(app: &AppHandle, audio_base64: String, speech_ended_at: Option<u64>) {
    let sequence = app
        .state::<crate::AudioState>()
        .segment_sequence
        .fetch_add(1, Ordering::SeqCst)
        + 1;
    let segment = SystemSpeechSegment {
        sequence,
        audio_base64: audio_base64.clone(),
        speech_ended_at,
    };
    let _ = app.emit("call-speech-segment", segment);
    // Preserve the original event for any existing Listen integrations.
    let _ = app.emit("speech-detected", audio_base64);
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            hop_size: 1024,
            sensitivity_rms: 0.012, // Much less sensitive - only real speech
            peak_threshold: 0.035,  // Higher threshold - filters clicks/noise
            silence_chunks: 20,     // ~0.46s at the nominal 44.1 kHz reference rate
            min_speech_chunks: 7,   // ~0.16s - captures short answers
            pre_speech_chunks: 12,  // ~0.27s - enough to catch word start
            noise_gate_threshold: 0.003, // Stronger noise filtering
            max_recording_duration_secs: 180, // 3 minutes default
        }
    }
}

#[tauri::command]
pub async fn start_system_audio_capture(
    app: AppHandle,
    vad_config: Option<VadConfig>,
    device_id: Option<String>,
    live_captions: Option<bool>,
) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();

    // Check if already capturing (atomic check)
    {
        let guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire lock: {}", e))?;

        if guard.is_some() {
            warn!("Capture already running");
            return Err("Capture already running".to_string());
        }
    }

    // Update VAD config if provided
    if let Some(config) = vad_config {
        validate_vad_config(&config)?;
        let mut vad_cfg = state
            .vad_config
            .lock()
            .map_err(|e| format!("Failed to acquire VAD config lock: {}", e))?;
        *vad_cfg = config;
    }

    let input = SpeakerInput::new_with_device(device_id).map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;

    let stream = input.stream();
    let sr = stream.sample_rate();

    // Validate sample rate
    if !(8000..=96000).contains(&sr) {
        error!("Invalid sample rate: {}", sr);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sr
        ));
    }

    let app_clone = app.clone();
    state
        .live_caption_frames
        .store(live_captions.unwrap_or(false), Ordering::Relaxed);
    let live_caption_frames = state.live_caption_frames.clone();
    let vad_config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to read VAD config: {}", e))?
        .clone();

    // Mark as capturing BEFORE spawning task
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to set capturing state: {}", e))? = true;

    // Emit capture started event
    let _ = app_clone.emit("capture-started", sr);

    let state_clone = app.state::<crate::AudioState>();
    let task = tokio::spawn(async move {
        if vad_config.enabled {
            run_vad_capture(
                app_clone.clone(),
                stream,
                sr,
                vad_config,
                live_caption_frames,
            )
            .await;
        } else {
            run_continuous_capture(
                app_clone.clone(),
                stream,
                sr,
                vad_config,
                live_caption_frames,
            )
            .await;
        }

        let state = app_clone.state::<crate::AudioState>();
        {
            if let Ok(mut guard) = state.stream_task.lock() {
                *guard = None;
            };
        }
    });

    *state_clone
        .stream_task
        .lock()
        .map_err(|e| format!("Failed to store task: {}", e))? = Some(task);

    Ok(())
}

// VAD-enabled capture - OPTIMIZED for real-time speech detection
async fn run_vad_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
    live_captions: Arc<AtomicBool>,
) {
    let mut stream = stream;
    let mut buffer: VecDeque<f32> = VecDeque::new();
    let silence_limit = scaled_vad_chunks(config.silence_chunks, sr);
    let min_speech_limit = scaled_vad_chunks(config.min_speech_chunks, sr);
    let pre_speech_limit = scaled_vad_chunks(config.pre_speech_chunks, sr);
    let mut pre_speech: VecDeque<f32> = VecDeque::with_capacity(pre_speech_limit * config.hop_size);
    let mut speech_buffer = Vec::new();
    let mut in_speech = false;
    let mut silence_chunks = 0;
    let mut speech_chunks = 0;
    let mut last_speech_at = None;
    let max_samples = sr as usize * 30; // 30s safety cap per utterance
    let mut live_frame = Vec::with_capacity((sr / 5) as usize);

    while let Some(sample) = stream.next().await {
        if live_captions.load(Ordering::Relaxed) {
            live_frame.push(sample);
            if live_frame.len() >= (sr / 5) as usize {
                emit_pcm_frame(&app, sr, &live_frame);
                live_frame.clear();
            }
        } else {
            live_frame.clear();
        }
        buffer.push_back(sample);

        // Process in fixed chunks for VAD analysis
        while buffer.len() >= config.hop_size {
            let mut mono = Vec::with_capacity(config.hop_size);
            for _ in 0..config.hop_size {
                if let Some(v) = buffer.pop_front() {
                    mono.push(v);
                }
            }

            // Apply noise gate BEFORE VAD (critical for accuracy)
            let mono = apply_noise_gate(&mono, config.noise_gate_threshold);

            let (rms, peak) = calculate_audio_metrics(&mono);
            let is_speech = rms > config.sensitivity_rms || peak > config.peak_threshold;

            if is_speech {
                last_speech_at = Some(wall_clock_ms());
                if !in_speech {
                    // Speech START detected
                    in_speech = true;
                    speech_chunks = 0;

                    // Include pre-speech buffer for natural sound
                    speech_buffer.extend(pre_speech.drain(..));

                    let _ = app.emit("speech-start", ());
                }

                speech_chunks += 1;
                speech_buffer.extend_from_slice(&mono);
                silence_chunks = 0; // Reset silence counter on any speech

                // Safety cap: force emit if exceeds 30s
                if speech_buffer.len() > max_samples {
                    let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                    if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                        // let duration = speech_buffer.len() as f32 / sr as f32;
                        emit_speech_segment(&app, b64, last_speech_at);
                    }
                    speech_buffer.clear();
                    in_speech = false;
                    speech_chunks = 0;
                    last_speech_at = None;
                }
            } else {
                // Silence detected
                if in_speech {
                    silence_chunks += 1;

                    // Continue collecting during silence (important for natural speech)
                    speech_buffer.extend_from_slice(&mono);

                    // Check if silence duration exceeds threshold
                    if silence_chunks >= silence_limit {
                        // Verify minimum speech duration
                        if speech_chunks >= min_speech_limit && !speech_buffer.is_empty() {
                            // Trim trailing silence (keep ~0.15s for natural ending)
                            let silence_duration_samples = silence_chunks * config.hop_size;
                            let keep_silence_samples = (sr as usize) * 15 / 100; // 0.15s
                            let trim_amount =
                                silence_duration_samples.saturating_sub(keep_silence_samples);

                            if speech_buffer.len() > trim_amount {
                                speech_buffer.truncate(speech_buffer.len() - trim_amount);
                            }

                            // Emit complete speech segment
                            let normalized_buffer = normalize_audio_level(&speech_buffer, 0.1);
                            if let Ok(b64) = samples_to_wav_b64(sr, &normalized_buffer) {
                                // let duration = speech_buffer.len() as f32 / sr as f32;
                                emit_speech_segment(&app, b64, last_speech_at);
                            } else {
                                error!("Failed to encode speech to WAV");
                                let _ = app.emit("audio-encoding-error", "Failed to encode speech");
                            }
                        } else {
                            let _ = app.emit(
                                "speech-discarded",
                                "Audio too short (likely background noise)",
                            );
                        }

                        // Reset for next speech detection
                        speech_buffer.clear();
                        in_speech = false;
                        silence_chunks = 0;
                        speech_chunks = 0;
                        last_speech_at = None;
                    }
                } else {
                    // Not in speech yet - maintain rolling pre-speech buffer
                    pre_speech.extend(mono.into_iter());

                    // Trim excess (maintain fixed size)
                    while pre_speech.len() > pre_speech_limit * config.hop_size {
                        pre_speech.pop_front();
                    }

                    // Periodically shrink capacity to prevent memory bloat
                    if pre_speech_limit > 0
                        && pre_speech.len() == pre_speech_limit * config.hop_size
                    {
                        pre_speech.shrink_to_fit();
                    }
                }
            }
        }
    }
}

// Continuous capture (VAD disabled)
async fn run_continuous_capture(
    app: AppHandle,
    stream: impl StreamExt<Item = f32> + Unpin,
    sr: u32,
    config: VadConfig,
    live_captions: Arc<AtomicBool>,
) {
    let mut stream = stream;
    let max_samples = (sr as u64 * config.max_recording_duration_secs) as usize;

    // Pre-allocate buffer to prevent reallocations
    let mut audio_buffer = Vec::with_capacity(max_samples);
    let start_time = Instant::now();
    let max_duration = Duration::from_secs(config.max_recording_duration_secs);
    let mut live_frame = Vec::with_capacity((sr / 5) as usize);

    // Atomic flag for manual stop
    let stop_flag = Arc::new(AtomicBool::new(false));
    let stop_flag_for_listener = stop_flag.clone();

    // Listen for manual stop event
    let stop_listener = app.listen("manual-stop-continuous", move |_| {
        stop_flag_for_listener.store(true, Ordering::Release);
    });

    // Emit recording started
    let _ = app.emit(
        "continuous-recording-start",
        config.max_recording_duration_secs,
    );

    // Accumulate audio - check stop flag on EVERY sample for immediate response
    loop {
        // Check stop flag FIRST on every iteration for immediate stopping
        if stop_flag.load(Ordering::Acquire) {
            break;
        }

        tokio::select! {
            sample_opt = stream.next() => {
                match sample_opt {
                    Some(sample) => {
                        if stop_flag.load(Ordering::Acquire) {
                            break;
                        }

                        audio_buffer.push(sample);
                        if live_captions.load(Ordering::Relaxed) {
                            live_frame.push(sample);
                            if live_frame.len() >= (sr / 5) as usize {
                                emit_pcm_frame(&app, sr, &live_frame);
                                live_frame.clear();
                            }
                        } else {
                            live_frame.clear();
                        }

                        let elapsed = start_time.elapsed();

                        // Emit progress every second
                        if audio_buffer.len() % (sr as usize) == 0 {
                            let _ = app.emit("recording-progress", elapsed.as_secs());
                        }

                        // Check size limit (safety)
                        if audio_buffer.len() >= max_samples {
                            break;
                        }

                        // Check time limit
                        if elapsed >= max_duration {
                            break;
                        }
                    },
                    None => {
                        warn!("Audio stream ended unexpectedly");
                        break;
                    }
                }
            }
            _ = tokio::time::sleep(tokio::time::Duration::from_millis(10)) => {
            }
        }
    }

    // Clean up event listener (CRITICAL)
    app.unlisten(stop_listener);

    // Process and emit audio
    if !audio_buffer.is_empty() {
        // let duration = start_time.elapsed().as_secs_f32();

        // Apply noise gate
        let cleaned_audio = apply_noise_gate(&audio_buffer, config.noise_gate_threshold);
        let cleaned_audio = normalize_audio_level(&cleaned_audio, 0.1);

        match samples_to_wav_b64(sr, &cleaned_audio) {
            Ok(b64) => {
                emit_speech_segment(&app, b64, None);
            }
            Err(e) => {
                error!("Failed to encode continuous audio: {}", e);
                let _ = app.emit("audio-encoding-error", e);
            }
        }
    } else {
        warn!("No audio captured in continuous mode");
        let _ = app.emit("audio-encoding-error", "No audio recorded");
    }

    let _ = app.emit("continuous-recording-stopped", ());
}

// Apply noise gate
fn apply_noise_gate(samples: &[f32], threshold: f32) -> Vec<f32> {
    const KNEE_RATIO: f32 = 3.0; // Compression ratio for soft knee

    if threshold <= 0.0 {
        return samples.to_vec();
    }

    samples
        .iter()
        .map(|&s| {
            let abs = s.abs();
            if abs < threshold {
                s * (abs / threshold).powf(1.0 / KNEE_RATIO)
            } else {
                s
            }
        })
        .collect()
}

// Calculate RMS and peak (optimized)
fn calculate_audio_metrics(chunk: &[f32]) -> (f32, f32) {
    let mut sumsq = 0.0f32;
    let mut peak = 0.0f32;

    for &v in chunk {
        let a = v.abs();
        peak = peak.max(a);
        sumsq += v * v;
    }

    let rms = (sumsq / chunk.len() as f32).sqrt();
    (rms, peak)
}

fn normalize_audio_level(samples: &[f32], target_rms: f32) -> Vec<f32> {
    if samples.is_empty() {
        return Vec::new();
    }

    let sum_squares: f32 = samples.iter().map(|&s| s * s).sum();
    let current_rms = (sum_squares / samples.len() as f32).sqrt();

    if current_rms < 0.001 {
        return samples.to_vec();
    }

    let gain = (target_rms / current_rms).min(10.0);

    samples
        .iter()
        .map(|&s| {
            let amplified = s * gain;
            if amplified.abs() > 1.0 {
                amplified.signum() * (1.0 - (-amplified.abs()).exp())
            } else {
                amplified
            }
        })
        .collect()
}

const STT_SAMPLE_RATE: u32 = 16_000;

/// Resample mono PCM before sending it to an STT provider.
///
/// Device capture rates vary (commonly 44.1 or 48 kHz), while the built-in
/// Google STT configuration is 16 kHz. Keeping the upload format consistent
/// avoids provider-side sample-rate mismatches and reduces request size.
fn resample_mono_linear(
    samples: &[f32],
    source_rate: u32,
    target_rate: u32,
) -> Result<Vec<f32>, String> {
    if !(8_000..=96_000).contains(&source_rate)
        || !(8_000..=96_000).contains(&target_rate)
    {
        return Err(format!(
            "Invalid sample rate: source={} target={}. Expected 8000-96000 Hz",
            source_rate, target_rate
        ));
    }
    if samples.is_empty() || source_rate == target_rate {
        return Ok(samples.to_vec());
    }

    let output_len = ((samples.len() as u64 * target_rate as u64)
        .div_ceil(source_rate as u64))
    .max(1) as usize;
    let source_step = source_rate as f64 / target_rate as f64;
    let last_index = samples.len() - 1;
    let mut output = Vec::with_capacity(output_len);

    for index in 0..output_len {
        let source_position = index as f64 * source_step;
        let left = source_position.floor() as usize;
        let left = left.min(last_index);
        let right = (left + 1).min(last_index);
        let fraction = (source_position - left as f64) as f32;
        output.push(samples[left] + (samples[right] - samples[left]) * fraction);
    }

    Ok(output)
}

// Convert samples to WAV base64 (with proper error handling)
fn samples_to_wav_b64(sample_rate: u32, mono_f32: &[f32]) -> Result<String, String> {
    // Validate sample rate
    if !(8000..=96000).contains(&sample_rate) {
        error!("Invalid sample rate: {}", sample_rate);
        return Err(format!(
            "Invalid sample rate: {}. Expected 8000-96000 Hz",
            sample_rate
        ));
    }

    // Validate buffer
    if mono_f32.is_empty() {
        return Err("Empty audio buffer".to_string());
    }

    let stt_samples = resample_mono_linear(mono_f32, sample_rate, STT_SAMPLE_RATE)?;
    let mut cursor = Cursor::new(Vec::new());
    let spec = WavSpec {
        channels: 1,
        sample_rate: STT_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut writer = WavWriter::new(&mut cursor, spec).map_err(|e| {
        error!("Failed to create WAV writer: {}", e);
        e.to_string()
    })?;

    for &s in &stt_samples {
        let clamped = s.clamp(-1.0, 1.0);
        let sample_i16 = (clamped * i16::MAX as f32) as i16;
        writer.write_sample(sample_i16).map_err(|e| e.to_string())?;
    }

    writer.finalize().map_err(|e| e.to_string())?;

    Ok(B64.encode(cursor.into_inner()))
}

#[tauri::command]
pub fn set_call_live_captions(app: AppHandle, enabled: bool) {
    app.state::<crate::AudioState>()
        .live_caption_frames
        .store(enabled, Ordering::Relaxed);
}

const NOMINAL_VAD_SAMPLE_RATE: u32 = 44_100;

fn scaled_vad_chunks(nominal_chunks: usize, sample_rate: u32) -> usize {
    if nominal_chunks == 0 {
        return 0;
    }
    ((nominal_chunks as u64 * sample_rate as u64 + NOMINAL_VAD_SAMPLE_RATE as u64 - 1)
        / NOMINAL_VAD_SAMPLE_RATE as u64)
        .max(1) as usize
}

fn validate_vad_config(config: &VadConfig) -> Result<(), String> {
    if !(256..=8192).contains(&config.hop_size)
        || !(1..=1000).contains(&config.silence_chunks)
        || !(1..=200).contains(&config.min_speech_chunks)
        || config.pre_speech_chunks > 200
        || !(1..=3600).contains(&config.max_recording_duration_secs)
        || ![
            config.sensitivity_rms,
            config.peak_threshold,
            config.noise_gate_threshold,
        ]
        .iter()
        .all(|value| value.is_finite() && (0.0..=1.0).contains(value))
    {
        return Err("Invalid VAD configuration".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod vad_config_tests {
    use super::{
        resample_mono_linear, samples_to_wav_b64, scaled_vad_chunks, validate_vad_config, VadConfig,
    };
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use std::io::Cursor;

    #[test]
    fn silence_duration_tracks_device_sample_rate() {
        for sample_rate in [16_000, 44_100, 48_000] {
            let chunks = scaled_vad_chunks(20, sample_rate);
            let duration = chunks as f64 * 1024.0 / sample_rate as f64;
            assert!((duration - 20.0 * 1024.0 / 44_100.0).abs() < 0.065);
        }
        assert_eq!(scaled_vad_chunks(0, 48_000), 0);
    }

    #[test]
    fn rejects_config_that_cannot_run_safely() {
        let mut config = VadConfig::default();
        assert!(validate_vad_config(&config).is_ok());
        config.hop_size = 0;
        assert!(validate_vad_config(&config).is_err());
        config.hop_size = 1024;
        config.sensitivity_rms = f32::NAN;
        assert!(validate_vad_config(&config).is_err());
    }

    #[test]
    fn zero_noise_gate_preserves_samples() {
        assert_eq!(
            super::apply_noise_gate(&[0.0, 0.25, -0.5], 0.0),
            vec![0.0, 0.25, -0.5]
        );
    }

    #[test]
    fn resampling_preserves_duration_and_endpoints() {
        let input = vec![-1.0, -0.5, 0.0, 0.5, 1.0];
        let output = resample_mono_linear(&input, 8_000, 16_000).unwrap();

        assert_eq!(output.len(), 10);
        assert!((output[0] + 1.0).abs() < 1e-6);
        assert!((output[output.len() - 1] - 1.0).abs() < 1e-6);
        assert!(output.windows(2).all(|pair| pair[0] <= pair[1]));
    }

    #[test]
    fn equal_rate_resampling_is_lossless() {
        let input = vec![0.1, -0.2, 0.3];
        assert_eq!(resample_mono_linear(&input, 16_000, 16_000).unwrap(), input);
    }

    #[test]
    fn resampling_rejects_invalid_rates() {
        assert!(resample_mono_linear(&[0.0], 7_999, 16_000).is_err());
        assert!(resample_mono_linear(&[0.0], 16_000, 96_001).is_err());
    }

    #[test]
    fn stt_wav_header_uses_fixed_sample_rate() {
        let encoded = samples_to_wav_b64(48_000, &vec![0.25; 480]).unwrap();
        let bytes = B64.decode(encoded).unwrap();
        let reader = hound::WavReader::new(Cursor::new(bytes)).unwrap();

        assert_eq!(reader.spec().sample_rate, 16_000);
        assert_eq!(reader.duration(), 160);
    }
}

#[tauri::command]
pub async fn stop_system_audio_capture(app: AppHandle) -> Result<(), String> {
    let state = app.state::<crate::AudioState>();
    state.live_caption_frames.store(false, Ordering::Relaxed);

    // Abort task in separate scope (Send trait fix)
    {
        let mut guard = state
            .stream_task
            .lock()
            .map_err(|e| format!("Failed to acquire task lock: {}", e))?;

        if let Some(task) = guard.take() {
            task.abort();
        }
    }

    // LONGER delay for proper cleanup (300ms instead of 150ms)
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Mark as not capturing
    *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to update capturing state: {}", e))? = false;

    // Additional cleanup delay (CRITICAL for mic indicator)
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Emit stopped event
    let _ = app.emit("capture-stopped", ());
    Ok(())
}

/// Manual stop for continuous recording
#[tauri::command]
pub async fn manual_stop_continuous(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("manual-stop-continuous", ());

    tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;

    Ok(())
}

#[tauri::command]
pub fn check_system_audio_access(_app: AppHandle) -> Result<bool, String> {
    match SpeakerInput::new() {
        Ok(_) => Ok(true),
        Err(e) => {
            error!("System audio access check failed: {}", e);
            Ok(false)
        }
    }
}

#[tauri::command]
pub async fn request_system_audio_access(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.shell()
            .command("open")
            .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_AudioCapture"])
            .spawn()
            .map_err(|e| {
                error!("Failed to open system preferences: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "windows")]
    {
        app.shell()
            .command("ms-settings:sound")
            .spawn()
            .map_err(|e| {
                error!("Failed to open sound settings: {}", e);
                e.to_string()
            })?;
    }
    #[cfg(target_os = "linux")]
    {
        let commands = ["pavucontrol", "gnome-control-center sound"];
        let mut opened = false;

        for cmd in &commands {
            if app.shell().command(cmd).spawn().is_ok() {
                opened = true;
                break;
            }
        }

        if !opened {
            warn!("Failed to open audio settings on Linux");
        }
    }

    Ok(())
}

// VAD Configuration Management
#[tauri::command]
pub async fn get_vad_config(app: AppHandle) -> Result<VadConfig, String> {
    let state = app.state::<crate::AudioState>();
    let config = state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to get VAD config: {}", e))?
        .clone();
    Ok(config)
}

#[tauri::command]
pub async fn update_vad_config(app: AppHandle, config: VadConfig) -> Result<(), String> {
    validate_vad_config(&config)?;

    let state = app.state::<crate::AudioState>();
    *state
        .vad_config
        .lock()
        .map_err(|e| format!("Failed to update VAD config: {}", e))? = config;

    Ok(())
}

#[tauri::command]
pub async fn get_capture_status(app: AppHandle) -> Result<bool, String> {
    let state = app.state::<crate::AudioState>();
    let is_capturing = *state
        .is_capturing
        .lock()
        .map_err(|e| format!("Failed to get capture status: {}", e))?;
    Ok(is_capturing)
}

#[tauri::command]
pub fn get_audio_sample_rate(_app: AppHandle) -> Result<u32, String> {
    let input = SpeakerInput::new().map_err(|e| {
        error!("Failed to create speaker input: {}", e);
        format!("Failed to access system audio: {}", e)
    })?;

    let stream = input.stream();
    let sr = stream.sample_rate();

    Ok(sr)
}

#[tauri::command]
pub fn get_input_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_input_devices().map_err(|e| {
        error!("Failed to get input devices: {}", e);
        format!("Failed to get input devices: {}", e)
    })
}

#[tauri::command]
pub fn get_output_devices() -> Result<Vec<AudioDevice>, String> {
    crate::speaker::list_output_devices().map_err(|e| {
        error!("Failed to get output devices: {}", e);
        format!("Failed to get output devices: {}", e)
    })
}
