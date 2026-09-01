const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const ChatRoom = require('../models/ChatRoom');
const ChatMessage = require('../models/ChatMessage');

// Group rooms are open community spaces — anyone signed in can read and
// post. Individual rooms are private 1-on-1s and require the requester to
// actually be one of the room's participants.
const canAccessRoom = (room, uid) =>
  room.type !== 'individual' || (room.participants || []).includes(uid);

// GET /api/chatrooms
// Individual rooms that aren't yours are excluded entirely, not just
// access-blocked when opened — otherwise the list itself would leak that
// a private conversation exists between two other people.
router.get('/', verifyToken, async (req, res) => {
  try {
    const rooms = await ChatRoom.find({
      $or: [{ type: 'group' }, { type: 'individual', participants: req.user.uid }],
    }).sort({ createdAt: -1 });
    res.status(200).json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/chatrooms
// Deliberately group-only. An "individual" room created through this
// generic form would have no participants set — nobody, including its
// creator, could ever access it once individual rooms are access-checked.
// The only real path to a genuine 1-on-1 is the tutor "Connect" flow
// (routes/tutors.js), which knows who both participants actually are.
router.post('/', verifyToken, async (req, res) => {
  try {
    const { name, description, course_id } = req.body;
    const room = new ChatRoom({ name, type: 'group', description, course_id });
    await room.save();
    res.status(201).json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/chatrooms/:id/messages
router.get('/:id/messages', verifyToken, async (req, res) => {
  try {
    const room = await ChatRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!canAccessRoom(room, req.user.uid)) {
      return res.status(403).json({ message: 'You do not have access to this conversation.' });
    }

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
    const room = await ChatRoom.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (!canAccessRoom(room, req.user.uid)) {
      return res.status(403).json({ message: 'You do not have access to this conversation.' });
    }

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
module.exports.canAccessRoom = canAccessRoom;
