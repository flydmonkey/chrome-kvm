pub mod ch9329;
pub mod reconnect;
pub mod service;

pub use ch9329::{absolute_mouse_packet, build_frame, keyboard_press_packet, keyboard_release_packet, map_to_absolute, relative_mouse_packet, KEYBOARD_RELEASE};
pub use reconnect::ReconnectingSerial;
pub use service::{open_hid, HidBackend, HidService, MockHid, SerialHid};
