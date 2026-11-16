use kvm_core::atx::{command, normalize_channel, PressKind, LONG_PRESS_MS, SHORT_PRESS_MS};

#[test]
fn lcus_command_bytes() {
    assert_eq!(command(1, true), [0xA0, 1, 1, 0xA2]);
    assert_eq!(command(1, false), [0xA0, 1, 0, 0xA1]);
    assert_eq!(command(2, true), [0xA0, 2, 1, 0xA3]);
}

#[test]
fn press_durations() {
    assert_eq!(PressKind::Short.duration_ms(), SHORT_PRESS_MS);
    assert_eq!(PressKind::Long.duration_ms(), LONG_PRESS_MS);
    assert_eq!(PressKind::Reset.duration_ms(), SHORT_PRESS_MS);
    assert_eq!(normalize_channel(9), 1);
    assert_eq!(normalize_channel(3), 3);
}
