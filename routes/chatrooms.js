const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');

// GET /api/chatrooms
router.get('/', verifyToken, async (req, res) => {
  try {
    const rooms = await ChatRoom.find().sort({ createdAt: -1 });
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/chatrooms
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, type, description, course_id } = req.body;
    const room = new ChatRoom({ name, type, description, course_id });
    await room.save();
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/chatrooms/:id/messages
router.get('/:id/messages', verifyToken, async (req, res) => {
  try {
    const messages = await ChatMessage.find({ room_id: req.params.id })
                                      .sort({ createdAt: 1 })
                                      .limit(200);
    res.status(200).json(messages);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/chatrooms/:id/messages
router.post('/:id/messages', verifyToken, async (req, res) => {
  try {
    const { content, author_name } = req.body;
    const room_id = req.params.id;

    const message = new ChatMessage({
      room_id,
      content,
      author_name,
      author_id: req.user.uid
    });

    await message.save();

    // Broadcast the message to all clients connected to this specific room via Socket.io
    const io = req.app.get('io');
    io.to(room_id).emit('receiveMessage', message);

    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
