/// Silence may produce no output events. Keep waiting until audio arrives or
/// the capture owner requests shutdown. Backoff also avoids a broken-handle spin.
pub(super) fn wait_for_audio(
    mut wait: impl FnMut() -> bool,
    mut stopped: impl FnMut() -> bool,
    mut backoff: impl FnMut(),
) -> bool {
    loop {
        if stopped() { return false; }
        if wait() { return true; }
        backoff();
    }
}

#[cfg(test)]
mod tests {
    use super::wait_for_audio;
    use std::cell::Cell;

    #[test]
    fn idle_timeouts_do_not_prevent_later_audio() {
        let attempts = Cell::new(0);
        let delays = Cell::new(0);
        let ready = wait_for_audio(
            || { attempts.set(attempts.get() + 1); attempts.get() == 3 },
            || false,
            || delays.set(delays.get() + 1),
        );
        assert!(ready);
        assert_eq!(attempts.get(), 3);
        assert_eq!(delays.get(), 2);
    }

    #[test]
    fn shutdown_during_idle_does_not_wait_forever() {
        let stop = Cell::new(false);
        let waits = Cell::new(0);
        let ready = wait_for_audio(
            || { waits.set(waits.get() + 1); false },
            || stop.get(),
            || stop.set(true),
        );
        assert!(!ready);
        assert_eq!(waits.get(), 1);
    }
}
