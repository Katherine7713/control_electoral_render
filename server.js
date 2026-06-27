require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    appwriteEndpoint: process.env.APPWRITE_ENDPOINT,
    appwriteProjectId: process.env.APPWRITE_PROJECT_ID,
  });
});

app.get('/verify-email', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
});

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
});

app.get('/api/buscar-perfil/:cedula', async (req, res) => {
  const { cedula } = req.params;

  const query = JSON.stringify({
    method: 'equal',
    attribute: 'cedula',
    values: [cedula]
  });

  const url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/perfiles/documents?queries[]=${encodeURIComponent(query)}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      }
    });

    const data = await response.json();

    if (!data.documents || data.documents.length === 0) {
      return res.status(404).json({ error: 'Cédula no registrada en el sistema' });
    }

    const perfil = data.documents[0];
    res.json({
      email:     perfil.email,
      nombres:   perfil.nombres,
      apellidos: perfil.apellidos,
    });

  } catch (e) {
    console.error('Error buscando perfil:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
