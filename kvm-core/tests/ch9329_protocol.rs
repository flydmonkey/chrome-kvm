use kvm_core::hid::ch9329::{
    absolute_mouse_packet, frame_from_parts, get_info_packet, keyboard_press_packet,
    keyboard_release_packet, map_to_absolute, relative_mouse_packet, KEYBOARD_RELEASE,
};

fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn frame_samples_match_js_protocol_doc() {
    assert_eq!(hex(&get_info_packet(0)), "57 ab 00 01 00 03");

    let key_a = frame_from_parts(&[0x57, 0xAB, 0x00, 0x02, 0x08, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]);
    assert_eq!(hex(&key_a), "57 ab 00 02 08 00 00 04 00 00 00 00 00 10");

    let release = keyboard_release_packet(0);
    assert_eq!(hex(&release), hex(&KEYBOARD_RELEASE));
    assert_eq!(hex(&release), "57 ab 00 02 08 00 00 00 00 00 00 00 00 0c");

    let shift_a = frame_from_parts(&[
        0x57, 0xAB, 0x00, 0x02, 0x08, 0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    assert_eq!(hex(&shift_a), "57 ab 00 02 08 02 00 04 00 00 00 00 00 12");

    let press = keyboard_press_packet(0, 0x00, &[0x04, 0, 0, 0, 0, 0]);
    assert_eq!(hex(&press), "57 ab 00 02 08 00 00 04 00 00 00 00 00 10");
}

#[test]
fn absolute_mouse_samples() {
    let down = absolute_mouse_packet(0, 0x01, 0, 0, 0);
    assert_eq!(hex(&down), "57 ab 00 04 07 02 01 00 00 00 00 00 10");
    let up = absolute_mouse_packet(0, 0x00, 0, 0, 0);
    assert_eq!(hex(&up), "57 ab 00 04 07 02 00 00 00 00 00 00 0f");

    let p1 = absolute_mouse_packet(0, 0x00, 320, 533, 0);
    assert_eq!(hex(&p1), "57 ab 00 04 07 02 00 40 01 15 02 00 67");
    let p2 = absolute_mouse_packet(0, 0x00, 3097, 2667, 0);
    assert_eq!(hex(&p2), "57 ab 00 04 07 02 00 19 0c 6b 0a 00 a9");
}

#[test]
fn relative_mouse_samples() {
    let down = relative_mouse_packet(0, 0x01, 0, 0, 0);
    assert_eq!(hex(&down), "57 ab 00 05 05 01 01 00 00 00 0e");
    let up = relative_mouse_packet(0, 0x00, 0, 0, 0);
    assert_eq!(hex(&up), "57 ab 00 05 05 01 00 00 00 00 0d");
    let left = relative_mouse_packet(0, 0x00, -3, 0, 0);
    assert_eq!(hex(&left), "57 ab 00 05 05 01 00 fd 00 00 0a");
    let down5 = relative_mouse_packet(0, 0x00, 0, 5, 0);
    assert_eq!(hex(&down5), "57 ab 00 05 05 01 00 00 05 00 12");
}

#[test]
fn map_to_absolute_1280x768() {
    assert_eq!(map_to_absolute(1280.0, 768.0, 100.0, 100.0), (320, 533));
    assert_eq!(map_to_absolute(1280.0, 768.0, 968.0, 500.0), (3097, 2666));
    assert_eq!(map_to_absolute(1920.0, 1080.0, 0.0, 0.0), (0, 0));
    assert_eq!(map_to_absolute(1920.0, 1080.0, 1920.0, 1080.0), (4095, 4095));
}
