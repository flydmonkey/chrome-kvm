//! CH9329 serial HID protocol (aligned with chrome-kvm `ch9329.js`).

mod keys;

pub use keys::{control_key_bit, hid_keycode, is_modifier, KEYBOARD_RELEASE};

pub const ADDR_DEFAULT: u8 = 0x00;
pub const CMD_GET_INFO: u8 = 0x01;
pub const CMD_SEND_KB_GENERAL_DATA: u8 = 0x02;
pub const CMD_SEND_MS_ABS_DATA: u8 = 0x04;
pub const CMD_SEND_MS_REL_DATA: u8 = 0x05;
pub const ABS_MAX: u16 = 4095;

/// SUM = sum(bytes) & 0xff; append checksum (mutates by returning new vec).
pub fn build_frame(addr: u8, cmd: u8, data: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + data.len() + 1);
    frame.push(0x57);
    frame.push(0xAB);
    frame.push(addr);
    frame.push(cmd);
    frame.push(data.len() as u8);
    frame.extend_from_slice(data);
    let sum = frame.iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    frame.push(sum);
    frame
}

/// Build frame from head without LEN already included — matches JS `toUnit8Array([0x57,0xAB,addr,cmd,len,...data])`.
pub fn frame_from_parts(parts: &[u8]) -> Vec<u8> {
    let mut frame = parts.to_vec();
    let sum = frame.iter().fold(0u8, |acc, b| acc.wrapping_add(*b));
    frame.push(sum);
    frame
}

pub fn get_info_packet(addr: u8) -> Vec<u8> {
    build_frame(addr, CMD_GET_INFO, &[])
}

pub fn keyboard_press_packet(addr: u8, modifiers: u8, keycodes: &[u8; 6]) -> Vec<u8> {
    let mut data = [0u8; 8];
    data[0] = modifiers;
    data[1] = 0x00;
    data[2..8].copy_from_slice(keycodes);
    build_frame(addr, CMD_SEND_KB_GENERAL_DATA, &data)
}

pub fn keyboard_release_packet(addr: u8) -> Vec<u8> {
    keyboard_press_packet(addr, 0, &[0; 6])
}

/// Absolute mouse: data = 02 + buttons + X_le + Y_le + wheel
pub fn absolute_mouse_packet(addr: u8, buttons: u8, x: u16, y: u16, wheel: u8) -> Vec<u8> {
    let mut data = [0u8; 7];
    data[0] = 0x02;
    data[1] = buttons;
    data[2] = (x & 0xff) as u8;
    data[3] = ((x >> 8) & 0xff) as u8;
    data[4] = (y & 0xff) as u8;
    data[5] = ((y >> 8) & 0xff) as u8;
    data[6] = wheel;
    build_frame(addr, CMD_SEND_MS_ABS_DATA, &data)
}

/// Relative mouse: data = 01 + buttons + dx + dy + wheel (dx/dy two's complement)
pub fn relative_mouse_packet(addr: u8, buttons: u8, dx: i8, dy: i8, wheel: u8) -> Vec<u8> {
    let data = [0x01, buttons, dx as u8, dy as u8, wheel];
    build_frame(addr, CMD_SEND_MS_REL_DATA, &data)
}

/// Map viewport content coords to 0..4095 absolute HID space.
/// `content_*` is the displayed content rect size (object-fit fill ⇒ full element).
pub fn map_to_absolute(
    content_w: f64,
    content_h: f64,
    local_x: f64,
    local_y: f64,
) -> (u16, u16) {
    if content_w <= 0.0 || content_h <= 0.0 {
        return (0, 0);
    }
    let nx = (local_x / content_w).clamp(0.0, 1.0);
    let ny = (local_y / content_h).clamp(0.0, 1.0);
    let x = ((nx * 4096.0).floor() as i32).clamp(0, 4095) as u16;
    let y = ((ny * 4096.0).floor() as i32).clamp(0, 4095) as u16;
    (x, y)
}
