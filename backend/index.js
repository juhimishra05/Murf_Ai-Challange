
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import { streamTextToMurf } from './murfClient.js';
dotenv.config();

const app = express();
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws-client' });

const PORT = process.env.PORT || 4000;


app.get('/', (req, res) => res.send('Murf Voice Chatbot backend'));


wss.on('connection', (ws) => {
  console.log('Frontend connected to backend WS');

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'speak') {
        const text = data.text || 'Hello from Murf demo';
        // Start Murf stream
        const murfStream = streamTextToMurf(text, data.voice);

        // When Murf emits binary audio chunks, forward to frontend as binary
        murfStream.on('audio', (chunk) => {
          // chunk is Buffer — forward directly to browser client
          ws.send(chunk, { binary: true }, (err) => {
            if (err) console.error('send error', err);
          });
        });

        murfStream.on('meta', (meta) => {
          // forward metadata as JSON
          ws.send(JSON.stringify({ type: 'meta', meta }));
        });

        murfStream.on('end', () => {
          ws.send(JSON.stringify({ type: 'end' }));
        });

        murfStream.on('error', (e) => {
          ws.send(JSON.stringify({ type: 'error', error: e.message || e }));
        });
      }
    } catch (e) {
      console.error('ws message parse err', e);
    }
  });

  ws.on('close', () => console.log('Frontend websocket closed'));
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
