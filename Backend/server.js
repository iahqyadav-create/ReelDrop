const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const app = express();

app.use(cors());
app.use(express.json());

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueName = Date.now() + '-' + file.originalname;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;

app.get('/', (req, res) => {
  res.send('ReelDrop backend is running');
});

// Video upload + caption generate
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file received' });
  }

  const filePath = req.file.path;

  try {
    // Step 1: Video file ko AssemblyAI ko upload karo
    const fileStream = fs.createReadStream(filePath);

    const uploadResponse = await axios.post(
      'https://api.assemblyai.com/v2/upload',
      fileStream,
      {
        headers: {
          authorization: ASSEMBLYAI_API_KEY,
          'transfer-encoding': 'chunked'
        }
      }
    );

    const audioUrl = uploadResponse.data.upload_url;

    // Step 2: Transcription request bhejo
    const transcriptResponse = await axios.post(
      'https://api.assemblyai.com/v2/transcript',
      {
        audio_url: audioUrl,
        language_detection: true
      },
      {
        headers: {
          authorization: ASSEMBLYAI_API_KEY
        }
      }
    );

    const transcriptId = transcriptResponse.data.id;

    // Step 3: Poll karke result ka wait karo
    let transcriptResult;
    while (true) {
      const pollingResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { authorization: ASSEMBLYAI_API_KEY }
        }
      );

      transcriptResult = pollingResponse.data;

      if (transcriptResult.status === 'completed') {
        break;
      } else if (transcriptResult.status === 'error') {
        throw new Error(transcriptResult.error);
      }

      // 3 second wait karke dobara check karo
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    // Uploaded file delete kar do (server space bachane ke liye)
    fs.unlinkSync(filePath);

    res.json({
      message: 'Caption generated successfully',
      text: transcriptResult.text,
      words: transcriptResult.words
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: 'Caption generation failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
