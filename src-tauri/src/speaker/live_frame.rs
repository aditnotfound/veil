/// Drain the remaining live PCM before publishing its VAD segment boundary.
/// The caller emits the segment only after this returns.
pub(super) fn flush_before_segment(frame: &mut Vec<f32>, mut emit: impl FnMut(&[f32])) {
    if !frame.is_empty() {
        emit(frame);
        frame.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::flush_before_segment;

    #[test]
    fn buffered_audio_precedes_segment_and_is_not_repeated() {
        let mut frame = vec![0.1, 0.2, 0.3];
        let mut emitted = Vec::new();
        flush_before_segment(&mut frame, |samples| emitted.push(samples.to_vec()));
        assert_eq!(emitted, vec![vec![0.1, 0.2, 0.3]]);
        assert!(frame.is_empty());
        flush_before_segment(&mut frame, |samples| emitted.push(samples.to_vec()));
        assert_eq!(emitted.len(), 1);
        frame.push(0.4);
        flush_before_segment(&mut frame, |samples| emitted.push(samples.to_vec()));
        assert_eq!(emitted[1], vec![0.4]);
    }
}
