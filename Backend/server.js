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

app.post('/upload', upload.single('video'), async (req, res) => {

  console.log('--- Naya upload request aaya ---');

  if (!req.file) {
    console.log('Error: Koi file nahi mili');
    return res.status(400).json({ error: 'No video file received' });
  }

  console.log('File mil gayi:', req.file.filename);
  console.log('API key set hai kya:', ASSEMBLYAI_API_KEY ? 'Haan' : 'NAHI - MISSING!');

  const filePath = req.file.path;

  try {
    console.log('AssemblyAI ko file bhej rahe hain...');

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

    console.log('File AssemblyAI par upload ho gayi');

    const audioUrl = uploadResponse.data.upload_url;

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

    console.log('Transcription request bhej di, ID:', transcriptResponse.data.id);

    const transcriptId = transcriptResponse.data.id;

    let transcriptResult;
    while (true) {
      const pollingResponse = await axios.get(
        `https://api.assemblyai.com/v2/transcript/${transcriptId}`,
        {
          headers: { authorization: ASSEMBLYAI_API_KEY }
        }
      );

      transcriptResult = pollingResponse.data;
      console.log('Status check:', transcriptResult.status);

      if (transcriptResult.status === 'completed') {
        break;
      } else if (transcriptResult.status === 'error') {
        throw new Error(transcriptResult.error);
      }

      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    fs.unlinkSync(filePath);

    console.log('SUCCESS! Text mila:', transcriptResult.text);

    res.json({
      message: 'Caption generated successfully',
      text: transcriptResult.text,
      words: transcriptResult.words
    });

  } catch (error) {
    console.log('ERROR AAYA:', error.message);
    if (error.response) {
      console.log('Error details:', JSON.stringify(error.response.data));
    }
    res.status(500).json({ error: 'Caption generation failed', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
