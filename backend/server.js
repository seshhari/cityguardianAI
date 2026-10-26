import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRoutes from './routes/api.js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 5001);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', apiRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'City Guardian AI backend is running.',
    documentation: '/api/health',
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`City Guardian AI backend listening on http://localhost:${port}`);
});
