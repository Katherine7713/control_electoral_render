require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const { Client, Users, ID } = require('node-appwrite');
const appwriteClient = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const users = new Users(appwriteClient);

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

app.post('/api/enviar-credenciales', async (req, res) => {
  const { email, nombre, password } = req.body;

  if(!email || !nombre || !password) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    await sgMail.send({
      to: email,
      from: 'sailemaastokaty@gmail.com',
      subject: 'Credenciales de acceso - Control Electoral Ecuador',
      html: `
        <p>Bienvenido <strong>${nombre}</strong>,</p>
        <p>Se ha creado tu cuenta en el sistema de Control Electoral.</p>
        <p>Tus credenciales de acceso son:</p>
          <ul>
            <li><strong>Correo electrónico:</strong> ${email}</li>
            <li><strong>Contraseña:</strong> ${password}</li>
          </ul>
        <p>Por tu seguridad, vas a poder realizar el cambio de contraseña al iniciar sesión</p>`
      });
      res.json({ ok: true });
    } catch (e) {
      console.error('Error enviando credenciales:', e);
      res.status(500).json({ error: 'Error al enviar el correo' });
    }
  });

app.post('/api/usuarios', async (req, res) => {
  const { email, password, name, phone } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Faltan email y/o password' });
  }

  try {
    const user = await users.create(ID.unique(), email, phone ?? null, password, name);
    res.json({ ok: true, userId: user.$id });
  } catch (e) {
    console.error('Error creando usuario:', e);
    res.status(500).json({ error: e.message || 'Error al crear usuario' });
  }
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

app.get('/api/perfil/:userId', async (req, res) => {
  const { userId } = req.params;

  const query = JSON.stringify({
    method: 'equal',
    attribute: 'user_id',
    values: [userId]
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
      return res.status(404).json({ error: 'Perfil no encontrado' });
    }

    const perfil = data.documents[0];
    res.json({
      docId:      perfil.$id,
      userId:     perfil.user_id,
      email:      perfil.email,
      nombres:    perfil.nombres,
      apellidos:  perfil.apellidos,
      rol:        perfil.rol,
      primerLogin: perfil.primer_login,
      activo:     perfil.activo,
    });

  } catch (e) {
    console.error('Error obteniendo perfil:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/actualizar-password', async (req, res) => {
  const { userId, newPassword } = req.body;

  const url = `${process.env.APPWRITE_ENDPOINT}/users/${userId}/password`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({ password: newPassword }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message });
    }

    res.json({ ok: true });

  } catch (e) {
    console.error('Error actualizando password:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/logout/:userId', async (req, res) => {
  const { userId } = req.params;

  const url = `${process.env.APPWRITE_ENDPOINT}/users/${userId}/sessions`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      return res.status(response.status).json({ error: data.message });
    }

    res.json({ ok: true });

  } catch (e) {
    console.error('Error en logout:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.patch('/api/perfil/:docId/completar-login', async (req, res) => {
  const { docId } = req.params;

  const url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/perfiles/documents/${docId}`;

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({
        data: {
          primer_login: false,
          ultimo_acceso: new Date().toISOString(),
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message });
    }

    res.json({ ok: true });

  } catch (e) {
    console.error('Error completando login:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

async function getCollection(collectionId, queries = []) {
  let url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/${collectionId}/documents?limit=100`;
  if (queries.length > 0) {
    queries.forEach(q => {
      url += `&queries[]=${encodeURIComponent(JSON.stringify(q))}`;
    });
  }
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
      'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
    }
  });
  const data = await response.json();
  return data.documents || [];
}

app.get('/api/dashboard-provincial', async (req, res) => {
  try {
    const [recintos, mesas, actas, organizaciones, perfiles, votos] = await Promise.all([
      getCollection('recintos'),
      getCollection('mesa_electoral'),
      getCollection('actas_escrutineo'),
      getCollection('organizaciones'),
      getCollection('perfiles'),
      getCollection('votos_organizacion'),
    ]);

    res.json({ recintos, mesas, actas, organizaciones, perfiles, votos });
  } catch (e) {
    console.error('Error dashboard provincial:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.delete('/api/recintos/:id', async (req, res) => {
  const { id } = req.params;
  const baseUrl = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections`;
  try {
    const mesaQuery = JSON.stringify({
      method: 'equal',
      attribute: 'recinto_id',
      values: [id]
    });
    const mesasUrl = `${baseUrl}/mesa_electoral/documents?queries[]=${encodeURIComponent(mesaQuery)}`;
    const mesasRes = await fetch(mesasUrl, {
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      }
    });
    const mesasData = await mesasRes.json();
    const mesasDocs = mesasData.documents || [];
    await Promise.all(mesasDocs.map(m => 
      fetch(`${baseUrl}/mesa_electoral/documents/${m.$id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
          'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
        }
      })
    ));
    const recintoRes = await fetch(`${baseUrl}/recintos/documents/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      }
    });
    if (!recintoRes.ok) {
      const errData = await recintoRes.json();
      return res.status(recintoRes.status).json({ error: errData.message });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error eliminando recinto:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/recintos', async (req, res) => {
  try {
    console.log('Body recibido:', JSON.stringify(req.body));
    const url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/recintos/documents`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({
        documentId: 'unique()',
        data: req.body,
      }),
    });
    const data = await response.json();
    console.log('Respuesta Appwrite recintos:', JSON.stringify(data));
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ id: data.$id });
  } catch (e) {
    console.error('Error:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/mesas', async (req, res) => {
  try {
    console.log('Creando mesa:', JSON.stringify(req.body));
    const url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/mesa_electoral/documents`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({
        documentId: 'unique()',
        data: req.body,
      }),
    });
    const data = await response.json();
    console.log('Respuesta Appwrite mesa:', JSON.stringify(data));
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ id: data.$id });
  } catch (e) {
    console.error('Error creando mesa:', e);
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/documentos/:coleccion/:docId', async (req, res) => {
  const { coleccion, docId } = req.params;
  try {
    const url = `${process.env.APPWRITE_ENDPOINT}/databases/${process.env.APPWRITE_DATABASE_ID}/collections/${coleccion}/documents/${docId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Appwrite-Project': process.env.APPWRITE_PROJECT_ID,
        'X-Appwrite-Key': process.env.APPWRITE_API_KEY,
      },
      body: JSON.stringify({ data: req.body }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
