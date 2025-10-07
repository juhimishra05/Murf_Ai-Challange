import WebSocket from 'ws';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';
dotenv.config();

const MURF_WS_URL = process.env.MURF_WS_URL;
const MURF_API_KEY = process.env.MURF_API_KEY;

export function streamTextToMurf(text, voice = 'en-in-voice-1') {
  const emitter = new EventEmitter();

  const ws = new WebSocket(MURF_WS_URL, {
    headers: {
      Authorization: `Bearer ${MURF_API_KEY}`,
      // Add other headers Murf expects (Content-Type etc.) per their docs
    },
  });

  ws.on('open', () => {
    // send a TTS start message per Murf protocol
    const msg = {
      type: 'speak',
      payload: {
        text,
        voice,
        // additional options like language, format: 'wav' or 'pcm'
      },
    };
    ws.send(JSON.stringify(msg));
  });

  ws.on('message', (data, isBinary) => {
    // Murf may send JSON control frames + binary audio frames.
    // If binary audio frames: emit 'audio' with ArrayBuffer/Buffer
    if (isBinary) {
      emitter.emit('audio', data); // Buffer
    } else {
      // JSON message (progress, done, error)
      try {
        const json = JSON.parse(data.toString());
        emitter.emit('meta', json);
        if (json.event === 'done') {
          emitter.emit('end');
          ws.close();
        }
      } catch (e) {
        // ignore parse errors
      }
    }
  });

  ws.on('close', () => emitter.emit('close'));
  ws.on('error', (err) => emitter.emit('error', err));

  return emitter;
}
