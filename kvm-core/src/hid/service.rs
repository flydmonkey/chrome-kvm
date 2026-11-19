use std::collections::VecDeque;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::Mutex;
use tracing::{info, warn};

use super::ch9329::{
    absolute_mouse_packet, control_key_bit, hid_keycode, is_modifier, keyboard_press_packet,
    keyboard_release_packet, map_to_absolute, relative_mouse_packet, ADDR_DEFAULT,
};

pub trait HidBackend: Send + Sync {
    fn write_packet(&self, packet: &[u8]) -> Result<()>;
}

pub struct MockHid {
    pub packets: Mutex<Vec<Vec<u8>>>,
}

impl MockHid {
    pub fn new() -> Self {
        Self {
            packets: Mutex::new(Vec::new()),
        }
    }

    pub fn take_packets(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.packets.lock())
    }
}

impl Default for MockHid {
    fn default() -> Self {
        Self::new()
    }
}

impl HidBackend for MockHid {
    fn write_packet(&self, packet: &[u8]) -> Result<()> {
        self.packets.lock().push(packet.to_vec());
        Ok(())
    }
}

pub struct SerialHid {
    port: Mutex<Box<dyn serialport::SerialPort>>,
}

impl SerialHid {
    pub fn open(path: &str, baud: u32) -> Result<Self> {
        let port = serialport::new(path, baud)
            .timeout(std::time::Duration::from_millis(200))
            .open()
            .with_context(|| format!("open serial {path}"))?;
        Ok(Self {
            port: Mutex::new(port),
        })
    }
}

impl HidBackend for SerialHid {
    fn write_packet(&self, packet: &[u8]) -> Result<()> {
        use std::io::Write;
        let mut port = self.port.lock();
        port.write_all(packet)?;
        port.flush()?;
        Ok(())
    }
}

struct KeyboardState {
    modifiers: u8,
    keys: VecDeque<u8>,
}

impl KeyboardState {
    fn new() -> Self {
        Self {
            modifiers: 0,
            keys: VecDeque::new(),
        }
    }

    fn keycodes_array(&self) -> [u8; 6] {
        let mut out = [0u8; 6];
        for (i, k) in self.keys.iter().take(6).enumerate() {
            out[i] = *k;
        }
        out
    }
}

pub struct HidService {
    backend: Arc<dyn HidBackend>,
    addr: u8,
    absolute: Mutex<bool>,
    kb: Mutex<KeyboardState>,
    buttons: Mutex<u8>,
    last_abs: Mutex<(u16, u16)>,
}

impl HidService {
    pub fn new(backend: Arc<dyn HidBackend>, absolute: bool) -> Self {
        Self {
            backend,
            addr: ADDR_DEFAULT,
            absolute: Mutex::new(absolute),
            kb: Mutex::new(KeyboardState::new()),
            buttons: Mutex::new(0),
            last_abs: Mutex::new((0, 0)),
        }
    }

    pub fn set_absolute(&self, absolute: bool) {
        *self.absolute.lock() = absolute;
    }

    pub fn absolute(&self) -> bool {
        *self.absolute.lock()
    }

    fn send(&self, packet: Vec<u8>) -> Result<()> {
        self.backend.write_packet(&packet)
    }

    pub fn keydown(&self, code: &str) -> Result<()> {
        if let Some(bit) = control_key_bit(code) {
            let mut kb = self.kb.lock();
            kb.modifiers |= bit;
            let pkt = keyboard_press_packet(self.addr, kb.modifiers, &kb.keycodes_array());
            drop(kb);
            return self.send(pkt);
        }
        let Some(kc) = hid_keycode(code) else {
            return Ok(());
        };
        let mut kb = self.kb.lock();
        if !kb.keys.contains(&kc) {
            if kb.keys.len() >= 6 {
                kb.keys.pop_front();
            }
            kb.keys.push_back(kc);
        }
        let pkt = keyboard_press_packet(self.addr, kb.modifiers, &kb.keycodes_array());
        drop(kb);
        self.send(pkt)
    }

    pub fn keyup(&self, code: &str) -> Result<()> {
        if let Some(bit) = control_key_bit(code) {
            let mut kb = self.kb.lock();
            kb.modifiers &= !bit;
            let pkt = keyboard_press_packet(self.addr, kb.modifiers, &kb.keycodes_array());
            drop(kb);
            return self.send(pkt);
        }
        let Some(kc) = hid_keycode(code) else {
            return Ok(());
        };
        let mut kb = self.kb.lock();
        kb.keys.retain(|k| *k != kc);
        let pkt = keyboard_press_packet(self.addr, kb.modifiers, &kb.keycodes_array());
        drop(kb);
        self.send(pkt)
    }

    pub fn release_all_keys(&self) -> Result<()> {
        {
            let mut kb = self.kb.lock();
            kb.modifiers = 0;
            kb.keys.clear();
        }
        self.send(keyboard_release_packet(self.addr))
    }

    pub fn mouse_move_abs(&self, content_w: f64, content_h: f64, x: f64, y: f64) -> Result<()> {
        let (ax, ay) = map_to_absolute(content_w, content_h, x, y);
        *self.last_abs.lock() = (ax, ay);
        let buttons = *self.buttons.lock();
        self.send(absolute_mouse_packet(self.addr, buttons, ax, ay, 0))
    }

    pub fn mouse_move_rel(&self, dx: i32, dy: i32) -> Result<()> {
        let buttons = *self.buttons.lock();
        let mut remain_x = dx;
        let mut remain_y = dy;
        while remain_x != 0 || remain_y != 0 {
            let step_x = remain_x.clamp(-127, 127) as i8;
            let step_y = remain_y.clamp(-127, 127) as i8;
            remain_x -= i32::from(step_x);
            remain_y -= i32::from(step_y);
            self.send(relative_mouse_packet(
                self.addr, buttons, step_x, step_y, 0,
            ))?;
        }
        Ok(())
    }

    pub fn mouse_button(&self, button: u8, down: bool) -> Result<()> {
        let mut buttons = self.buttons.lock();
        if down {
            *buttons |= button;
        } else {
            *buttons &= !button;
        }
        let b = *buttons;
        drop(buttons);
        if *self.absolute.lock() {
            let (x, y) = *self.last_abs.lock();
            self.send(absolute_mouse_packet(self.addr, b, x, y, 0))
        } else {
            self.send(relative_mouse_packet(self.addr, b, 0, 0, 0))
        }
    }

    pub fn mouse_wheel(&self, wheel: i8) -> Result<()> {
        let buttons = *self.buttons.lock();
        if *self.absolute.lock() {
            let (x, y) = *self.last_abs.lock();
            self.send(absolute_mouse_packet(
                self.addr,
                buttons,
                x,
                y,
                wheel as u8,
            ))
        } else {
            self.send(relative_mouse_packet(
                self.addr, buttons, 0, 0, wheel as u8,
            ))
        }
    }

    pub fn force_release_all(&self) -> Result<()> {
        *self.buttons.lock() = 0;
        let _ = self.release_all_keys();
        if *self.absolute.lock() {
            let (x, y) = *self.last_abs.lock();
            self.send(absolute_mouse_packet(self.addr, 0, x, y, 0))
        } else {
            self.send(relative_mouse_packet(self.addr, 0, 0, 0, 0))
        }
    }
}

pub fn open_hid(
    path: Option<&str>,
    baud: u32,
    absolute: bool,
) -> Result<(Arc<HidService>, Option<Arc<MockHid>>)> {
    if let Some(path) = path {
        if path == "mock" || path.is_empty() {
            let mock = Arc::new(MockHid::new());
            let svc = Arc::new(HidService::new(mock.clone(), absolute));
            info!("HID backend: mock");
            return Ok((svc, Some(mock)));
        }
        match crate::hid::ReconnectingSerial::open(path, baud) {
            Ok(serial) => {
                info!(%path, baud, "HID backend: serial (reconnect)");
                Ok((
                    Arc::new(HidService::new(Arc::new(serial), absolute)),
                    None,
                ))
            }
            Err(e) => {
                warn!(%path, error = %e, "serial open failed; falling back to mock");
                let mock = Arc::new(MockHid::new());
                Ok((
                    Arc::new(HidService::new(mock.clone(), absolute)),
                    Some(mock),
                ))
            }
        }
    } else {
        let mock = Arc::new(MockHid::new());
        info!("HID backend: mock (no serial_port configured)");
        Ok((Arc::new(HidService::new(mock.clone(), absolute)), Some(mock)))
    }
}

#[allow(dead_code)]
pub fn require_known_key(code: &str) -> Result<()> {
    if is_modifier(code) || hid_keycode(code).is_some() {
        Ok(())
    } else {
        Err(anyhow!("unknown key code {code}"))
    }
}
