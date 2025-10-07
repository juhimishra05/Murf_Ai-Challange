import React, { useEffect, useRef, useState } from 'react';
import './VoiceChat.css';

export default function VoiceChat() {
  const [wsStatus, setWsStatus] = useState('closed');
  const [transcript, setTranscript] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [language, setLanguage] = useState('en-IN');
  const [voice, setVoice] = useState('default');
  const wsRef = useRef(null);
  const recogRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recRecorderRef = useRef(null);
  const audioCtxRef = useRef(null);

  // ===== WebSocket setup =====
  useEffect(() => {
    // Adjust backend host/port if different in production
    const host = location.hostname || 'localhost';
    const port = 4000;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${host}:${port}/ws-client`;

    const socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => setWsStatus('connected');
    socket.onclose = () => setWsStatus('closed');
    socket.onerror = (ev) => {
      console.error('WebSocket error', ev);
      setWsStatus('error');
    };

    socket.onmessage = (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        playAudioChunk(evt.data);
        return;
      }
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'reply_text') setReplyText(msg.text);
        if (msg.type === 'audio_end') {
          console.log('Audio stream ended');
        }
      } catch (e) {
        console.log('WS non-json', evt.data);
      }
    };

    wsRef.current = socket;
    return () => {
      socket.close();
    };
  }, []);

  // ===== Audio playback =====
  function ensureAudioCtx() {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  }
  async function playAudioChunk(arrayBuffer) {
    const ctx = ensureAudioCtx();
    try {
      // decodeAudioData handles WAV/MP3/OGG. If Murf uses raw PCM, we must adapt.
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      src.connect(ctx.destination);
      src.start();
    } catch (e) {
      console.error('Failed decode audio chunk', e);
    }
  }

  // ===== Microphone / SpeechRecognition setup =====
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      recogRef.current = null;
      console.log('SpeechRecognition not supported in this browser.');
      return;
    }
    const recog = new SpeechRecognition();
    recog.lang = language;
    recog.interimResults = true;
    recog.continuous = false;

    recog.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setTranscript(final || interim);
    };
    recog.onend = () => {
      setIsListening(false);
    };
    recog.onerror = (err) => {
      console.error('SpeechRecognition error', err);
      setErrorMsg('Speech recognition error: ' + (err.error || err.message || err));
      setIsListening(false);
    };

    recogRef.current = recog;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  // Request mic permission (calls getUserMedia to force browser prompt)
  async function ensureMicrophonePermission() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setErrorMsg('Microphone not supported in this browser.');
        return false;
      }
      if (mediaStreamRef.current) return true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      return true;
    } catch (e) {
      console.error('getUserMedia error', e);
      setErrorMsg('Microphone access denied or not available. Check browser permissions.');
      return false;
    }
  }

  async function startListening() {
    setErrorMsg('');
    const ok = await ensureMicrophonePermission();
    if (!ok) return;

    const recog = recogRef.current;
    if (recog) {
      try {
        recog.lang = language;
        recog.start();
        setIsListening(true);
        setTranscript('');
        return;
      } catch (e) {
        console.warn('SpeechRecognition start error', e);
      }
    }

    // Fallback: record short audio via MediaRecorder and then send to backend for transcription (if implemented).
    // We'll start a MediaRecorder to capture audio and show visual feedback.
    try {
      const stream = mediaStreamRef.current;
      const recorder = new MediaRecorder(stream);
      recRecorderRef.current = recorder;
      const chunks = [];
      recorder.ondataavailable = (ev) => chunks.push(ev.data);
      recorder.onstart = () => {
        setIsListening(true);
        setTranscript('(recording...)');
      };
      recorder.onstop = async () => {
        setIsListening(false);
        const blob = new Blob(chunks, { type: 'audio/webm' });
        setTranscript('(recorded audio ready - currently no server STT fallback configured)');
        // Optionally upload blob to backend STT endpoint (not implemented here).
        // e.g. uploadAudio(blob)
      };
      recorder.start();
      // auto-stop after 6 seconds (you can change)
      setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 6000);
    } catch (e) {
      console.error('MediaRecorder fallback error', e);
      setErrorMsg('Could not start microphone recording.');
    }
  }

  function stopListening() {
    const recog = recogRef.current;
    if (recog) {
      try {
        recog.stop();
      } catch (e) {
        console.warn('recog stop', e);
      }
    }
    const recorder = recRecorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
    setIsListening(false);
  }

  // ===== Sending text to backend =====
  function sendText(textToSend) {
    if (!textToSend || !textToSend.trim()) return;
    setReplyText('');
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMsg('WebSocket not connected to backend.');
      return;
    }
    const payload = { type: 'speak', text: textToSend, voice, language };
    ws.send(JSON.stringify(payload));
  }

  // Quick keyboard Enter send
  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
      sendText(transcript || (document.getElementById('manualInput')?.value || ''));
    }
  }

  return (
    <div className="vc-container">
      <header className="vc-header">
        <div className="vc-title">🎧 Murf Multilingual Voice Studio</div>
        <div className="vc-sub">Voice Chatbot (low-latency Murf TTS)</div>
      </header>

      <div className="vc-panel">
        <div className="vc-left">
          <div className="vc-row">
            <label className="vc-label">WebSocket:</label>
            <span className={`vc-status ${wsStatus}`}>{wsStatus}</span>
          </div>

          <div className="vc-row">
            <label className="vc-label">Language:</label>
            <select value={language} onChange={(e)=>setLanguage(e.target.value)} className="vc-select">
              <option value="en-IN">English (India)</option>
              <option value="hi-IN">Hindi</option>
              <option value="mr-IN">Marathi</option>
              <option value="te-IN">Telugu</option>
              <option value="kn-IN">Kannada</option>
              <option value="gu-IN">Gujarati</option>
              <option value="ta-IN">Tamil</option>
            </select>
            <label className="vc-label" style={{marginLeft:12}}>Voice:</label>
            <select value={voice} onChange={(e)=>setVoice(e.target.value)} className="vc-select">
              <option value="default">Default</option>
              <option value="male-1">Male 1</option>
              <option value="female-1">Female 1</option>
            </select>
          </div>

          <textarea
            id="manualInput"
            className="vc-textarea"
            placeholder="Type a message or use the mic..."
            rows={6}
            onKeyDown={handleKeyDown}
          />

          <div className="vc-actions">
            <button className={`vc-btn ${isListening ? 'listening' : ''}`} onClick={() => (isListening ? stopListening() : startListening())}>
              {isListening ? 'Stop' : 'Speak'}
            </button>

            <button
              className="vc-btn primary"
              onClick={() => {
                const t = transcript || document.getElementById('manualInput')?.value || '';
                sendText(t);
              }}
            >
              Send
            </button>

            <div className="vc-tip">Tip: Press <kbd>Ctrl/Shift+Enter</kbd> to send typed/recognized text.</div>
          </div>

          <div className="vc-info">
            <strong>Transcript:</strong>
            <div className="vc-transcript">{transcript}</div>
            <strong>Assistant (text):</strong>
            <div className="vc-reply">{replyText}</div>
            {errorMsg && <div className="vc-error">{errorMsg}</div>}
          </div>
        </div>

        <div className="vc-right">
          <div className={`vc-visual ${isListening ? 'active' : ''}`}>
            <div className="vc-wave" />
            <div className="vc-wave delay" />
            <div className="vc-wave delay2" />
          </div>
          <div className="vc-card">
            <h3>Live Status</h3>
            <p>Microphone: {mediaStreamRef.current ? 'access granted' : 'not requested'}</p>
            <p>SpeechRecognition: {recogRef.current ? 'supported' : 'not supported'}</p>
            <p>Browser: {navigator.userAgent}</p>
          </div>
        </div>
      </div>

      <footer className="vc-footer">
        <small>Allow microphone in your browser and run this app on <strong>localhost</strong> (or HTTPS) for mic access.</small>
      </footer>
    </div>
  );
}
