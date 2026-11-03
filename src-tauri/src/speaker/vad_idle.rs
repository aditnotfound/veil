/// A 100 ms tick only supplies silence after two ticks without real samples.
/// Real audio always resets the counter, preventing repeated padding while the
/// device is actively delivering packets.
#[derive(Default)]
pub(super) struct VadIdle {
    received: bool,
    empty_ticks: u8,
}

impl VadIdle {
    pub(super) fn on_audio(&mut self) {
        self.received = true;
        self.empty_ticks = 0;
    }

    pub(super) fn on_tick(&mut self) -> bool {
        if self.received {
            self.received = false;
            self.empty_ticks = 0;
            return false;
        }
        self.empty_ticks = self.empty_ticks.saturating_add(1);
        self.empty_ticks >= 2
    }
}

#[cfg(test)]
mod tests {
    use super::VadIdle;

    #[test]
    fn silence_padding_waits_for_two_idle_ticks_and_audio_resets_it() {
        let mut idle = VadIdle::default();
        idle.on_audio();
        assert!(!idle.on_tick());
        assert!(!idle.on_tick());
        assert!(idle.on_tick());
        assert!(idle.on_tick());
        idle.on_audio();
        assert!(!idle.on_tick());
        assert!(!idle.on_tick());
        assert!(idle.on_tick());
    }

    #[test]
    fn regular_audio_never_requests_silence_padding() {
        let mut idle = VadIdle::default();
        for _ in 0..100 {
            idle.on_audio();
            assert!(!idle.on_tick());
        }
    }
}
