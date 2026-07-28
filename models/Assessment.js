const mongoose = require('mongoose');

const assessmentSchema = new mongoose.Schema({
  course_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Course', 
    required: true 
  },
  title: { type: String, required: true },
  type: { type: String, enum: ['test', 'exam'], required: true },
  description: String,
  theory_questions: [{
    question: { type: String, required: true },
    sample_answer: String,
    max_marks: { type: Number, default: 10 }
  }],
  objective_questions: [{
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correct_option: { type: Number, required: true } // Index of correct option
  }]
}, { timestamps: true });

module.exports = mongoose.model('Assessment', assessmentSchema);
