# HAVEN — Demo & Phone-Mirroring Setup

Your laptop's current Wi-Fi IP: **`192.168.100.14`**
(If your network changes, re-check with `ipconfig` → look at the Wi-Fi adapter's IPv4 address.)

---

## (a) Run the app network-wide

```powershell
npm run dev
```

This starts both the backend proxy (`0.0.0.0:8787`) and the Vite frontend
(`0.0.0.0:5173`), both now exposed on your local network. Vite prints a
**Network:** URL when it boots — that's the one to use on your phone.

Make sure your laptop and phone are on the **same Wi-Fi**, and that Windows
Firewall allows Node on private networks (accept the prompt the first time).

## (b) Open it on your phone

In your phone's browser:

```
http://192.168.100.14:5173
```

> The frontend calls the backend through a relative `/api` path, which Vite
> proxies to the backend on the laptop. So the phone only needs the `:5173`
> URL above — it does **not** need to know the backend (`:8787`) address.

## (c) Mirror the phone with scrcpy (for screen recording)

One-time on the phone: **Settings → About phone → tap Build number 7×** to
unlock Developer options, then **Settings → Developer options → enable USB
debugging**.

Then plug the phone into the laptop via USB and accept the "Allow USB
debugging?" prompt on the phone. Launch the mirror:

```powershell
scrcpy
```

Useful flags:
- `scrcpy --turn-screen-off` — mirror while the phone screen stays dark (saves battery; screen still records).
- `scrcpy --max-size 1080` — cap resolution for smoother recording.
- `scrcpy --record demo.mp4` — record straight to a file.

Verify the phone is detected first with `adb devices` (adb ships with scrcpy).

## (d) Fallback: Chrome DevTools mobile view (no phone needed)

On the laptop, open the app in Chrome at `http://localhost:5173`, then:

1. Press **F12** (or Ctrl+Shift+I) to open DevTools.
2. Click the **Toggle device toolbar** icon (Ctrl+Shift+M).
3. Pick a device (e.g. *iPhone 14 Pro* / *Pixel 7*) from the top dropdown.
4. Record the Chrome window with your screen recorder (or Win+G Game Bar).

---

### Quick reference

| Need | Command / URL |
|---|---|
| Run app network-wide | `npm run dev` |
| Open on phone | `http://192.168.100.14:5173` |
| Mirror phone | `scrcpy` |
| Check phone is connected | `adb devices` |
| DevTools mobile view | F12 → Ctrl+Shift+M |
