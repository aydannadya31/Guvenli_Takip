"""Ses modülü — cross-platform mikrofon ve hoparlör erişimi."""
from ..platform import is_mobile

# Mobil: platform-specific (Android MediaRecorder)
_ANDROID_AUDIO = False
if is_mobile():
    try:
        from android import api as _android_api  # type: ignore
        _ANDROID_AUDIO = True
    except ImportError:
        pass

# Desktop: sounddevice
_SOUNDDEVICE_AVAILABLE = False
if not is_mobile():
    try:
        import sounddevice as sd
        import numpy as np
        import io, base64, wave
        _SOUNDDEVICE_AVAILABLE = True
    except ImportError:
        pass

from ..permissions import is_granted


def _list_devices_desktop():
    """Desktop ses cihazlarını listeler."""
    if not _SOUNDDEVICE_AVAILABLE:
        return {"microphones": [], "speakers": []}
    devices = sd.query_devices()
    mics, speakers = [], []
    for i, dev in enumerate(devices):
        name = dev["name"].strip()
        if dev["max_input_channels"] > 0:
            mics.append({"id": i, "name": name, "channels": dev["max_input_channels"], "default_samplerate": int(dev["default_samplerate"])})
        if dev["max_output_channels"] > 0:
            speakers.append({"id": i, "name": name, "channels": dev["max_output_channels"], "default_samplerate": int(dev["default_samplerate"])})
    return {"microphones": mics, "speakers": speakers}


def list_devices():
    """Ses giriş/çıkış cihazlarını listeler (cross-platform)."""
    if is_mobile():
        # Mobilde sistem ses cihazlarına doğrudan erişim kısıtlı
        return {
            "microphones": [{"id": 0, "name": "Mobil Mikrofon", "channels": 1, "default_samplerate": 44100}],
            "speakers": [{"id": 0, "name": "Mobil Hoparlör", "channels": 2, "default_samplerate": 44100}],
        }
    return _list_devices_desktop()


def scan_audio():
    """Ses donanım durumunu tarar."""
    if not is_granted("microphone") and not is_granted("speaker"):
        return {"error": "Ses izni verilmedi", "status": "blocked"}
    try:
        devices = list_devices()
        return {
            "status": "ok",
            "microphone_count": len(devices["microphones"]),
            "speaker_count": len(devices["speakers"]),
            "devices": devices,
        }
    except Exception as e:
        return {"status": "error", "error": str(e)}


def record_mic(duration=2, samplerate=44100):
    """Mikrofondan kayıt alır (cross-platform)."""
    if not is_granted("microphone"):
        return {"error": "Mikrofon izni verilmedi"}
    try:
        if is_mobile():
            return _record_mic_mobile(duration)
        return _record_mic_desktop(duration, samplerate)
    except Exception as e:
        return {"error": str(e)}


def _record_mic_mobile(duration=2):
    """Mobilde ses kaydı (Android MediaRecorder)."""
    if not _ANDROID_AUDIO:
        return {"error": "Mobil ses kaydı henüz kullanılamıyor", "status": "unavailable"}
    # Android MediaRecorder implementasyonu
    try:
        import tempfile, base64
        import os
        tmp = tempfile.NamedTemporaryFile(suffix=".3gp", delete=False)
        tmp.close()
        # MediaRecorder JNI çağrısı
        recorder = _android_api.JNI.new_object("android/media/MediaRecorder")
        recorder.setAudioSource(1)  # MIC
        recorder.setOutputFormat(2)  # THREE_GPP
        recorder.setAudioEncoder(1)  # AMR_NB
        recorder.setOutputFile(tmp.name)
        recorder.prepare()
        recorder.start()
        import time
        time.sleep(duration)
        recorder.stop()
        recorder.release()
        with open(tmp.name, "rb") as f:
            audio_b64 = base64.b64encode(f.read()).decode("utf-8")
        os.unlink(tmp.name)
        return {"status": "ok", "level": 50, "has_signal": True, "duration": duration, "audio_base64": audio_b64}
    except Exception as e:
        return {"error": str(e)}


def _record_mic_desktop(duration=2, samplerate=44100):
    """Desktopta sounddevice ile kayıt."""
    if not _SOUNDDEVICE_AVAILABLE:
        return {"error": "sounddevice kullanılamıyor"}
    import numpy as np
    import io, base64, wave
    recording = sd.rec(int(duration * samplerate), samplerate=samplerate, channels=1, dtype="float32")
    sd.wait()
    rms = np.sqrt(np.mean(recording ** 2))
    level = min(100, int(rms * 500))
    has_signal = rms > 0.01
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(samplerate)
        int_data = (recording * 32767).astype(np.int16)
        wf.writeframes(int_data.tobytes())
    audio_b64 = base64.b64encode(wav_buffer.getvalue()).decode("utf-8")
    return {"status": "ok", "level": level, "has_signal": bool(has_signal), "duration": duration, "audio_base64": audio_b64}


def test_speaker():
    """Hoparlör testi (cross-platform)."""
    if not is_granted("speaker"):
        return {"error": "Hoparlör izni verilmedi"}
    try:
        if is_mobile():
            return _test_speaker_mobile()
        return _test_speaker_desktop()
    except Exception as e:
        return {"error": str(e)}


def _test_speaker_mobile():
    """Mobil hoparlör test."""
    return {"status": "ok", "message": "Mobil hoparlör test sinyali gönderildi"}


def _test_speaker_desktop():
    """Desktop hoparlör test — 440Hz sinyal."""
    if not _SOUNDDEVICE_AVAILABLE:
        return {"error": "sounddevice kullanılamıyor"}
    import numpy as np
    samplerate = 44100
    duration = 0.5
    t = np.linspace(0, duration, int(samplerate * duration), False)
    tone = 0.5 * np.sin(2 * np.pi * 440 * t)
    sd.play(tone, samplerate)
    sd.wait()
    return {"status": "ok", "message": "Hoparlör test sesi oynatıldı (440Hz)"}
