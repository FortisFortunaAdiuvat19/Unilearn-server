require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');
const connectDB = require('./config/db');

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// FRONTEND_URL can be a single origin or a comma-separated list (prod domain,
// a preview domain, localhost for local dev, etc). A mismatch here — wrong
// value, http vs https, a trailing slash — silently blocks every request
// from the frontend with a CORS error, which from the client looks
// indistinguishable from an auth failure.
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // No Origin header = server-to-server / curl / health checks — allow.
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Not allowed by CORS: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  credentials: true
};

// Middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(cors(corsOptions));

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('joinRoom', (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  socket.on('leaveRoom', (roomId) => {
    socket.leave(roomId);
    console.log(`User ${socket.id} left room ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

// Pass the io instance to routes if needed
app.set('io', io);

// Basic Health Check Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'UniLearn API is running' });
});

// --- API Routes will be imported here in the next step ---
// Route Middleware
app.use('/api/auth', require('./routes/auth'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/enrollments', require('./routes/enrollments'));
app.use('/api/chatrooms', require('./routes/chatrooms'));
app.use('/api/assessments', require('./routes/assessments'));
app.use('/api/recommendations', require('./routes/recommendations'));
app.use('/api/tutors', require('./routes/tutors'));
app.use('/api/youtube', require('./routes/youtube'));

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong on the server!' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
