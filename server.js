require('dotenv').config();
const cors = require('cors');
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());
const PORT = process.env.PORT || 3000;

const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const { Client, Users, ID, Teams, Databases, Query } = require('node-appwrite');

const appwriteClient = new Client()
  .setEndpoint(process.env.APPWRITE_ENDPOINT)
  .setProject(process.env.APPWRITE_PROJECT_ID)
  .setKey(process.env.APPWRITE_API_KEY);
const users = new Users(appwriteClient);
const teams = new Teams(appwriteClient);
const databases = new Databases(appwriteClient);

const DATABASE_ID = process.env.APPWRITE_DATABASE_ID;
const COLLECTION_PERFILES = 'perfiles';

const TEAM_IDS = {
  coordinador_recinto: process.env.TEAM_ID_COORDINADOR_RECINTO,
  veedor: process.env.TEAM_ID_VEEDORES,
  coordinador_provincial: process.env.TEAM_ID_COORDINADORES_PROVINCIALES,
};

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
  const { userId, email, nombre, password } = req.body;

  if(!userId || !email || !nombre || !password) {
    return res.status(400).json({ error: 'Faltan datos requeridos' });
  }

  try {
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await users.updatePrefs(userId, {
      verification_token: verificationToken,
      verification_created_at: Date.now(),
    });

    const verifyUrl = `https://control-electoral.onrender.com/verify-email?userId=${userId}&token=${verificationToken}`;
    
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
        <p>Por tu seguridad, vas a poder realizar el cambio de contraseña al iniciar sesión</p>
        <p>Antes de continuar, confirma tu correo electrónico</p>
        <p>style="margin: 24px 0;">
          <a href="${verifyUrl}"
              style="background-color:#1a56db;color:#ffffff;padding:12px 24px;
                    text-decoration:none;border-radius:6px;font-weight:bold;
                    display:inline-block;">
            Verificar mi correo electrónico
          </a>
        </p>
        <p style="font-size:12px;color:#666;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
          ${verifyUrl}
        </p>`
      });
      res.json({ ok: true });
    } catch (e) {
      console.error('Error enviando credenciales:', e);
      res.status(500).json({ error: 'Error al enviar el correo' });
    }
  });

app.post('/api/verify-email', async (req, res) => {
  const { userId, token } = req.body;

  if (!userId || !token) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const prefs = await users.getPrefs(userId);

    if (!prefs.verification_token || prefs.verification_token !== token) {
      return res.status(400).json({ error: 'Enlace inválido o ya utilizado'
      });
    }

    const createdAt = Number(prefs.verification_created_at) || 0;
    const EXPIRY_MS = 5 * 60 * 1000;
    if (Date.now() - createdAt > EXPIRY_MS) {
      return res.status(400).json({ error: 'El enlace ha expirado. Solicita que te reenvíen las credenciales.' });
    }

    await users.updateEmailVerification(userId, true);
    const { verification_token, verification_created_at, ...restPrefs } = prefs;
    await users.updatePrefs(userId, restPrefs);

    res.json({ ok: true });
  } catch (e) {
        console.error('Error verificando email:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/reenviar-verificacion', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta el correo electrónico' });

  try {
    const userList = await users.list([Query.equal('email', email)]);

    if (userList.total === 0) {
      return res.json({ ok: true });
    }

    const user = userList.users[0];

    if (user.emailVerification) {
      return res.json({ ok: true, yaVerificado: true });
    }

    const existingPrefs = await users.getPrefs(user.$id);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    await users.updatePrefs(user.$id, {
      ...existingPrefs,
      verification_token: verificationToken,
      verification_created_at: Date.now(),
    });

    const verifyUrl = `https://control-electoral.onrender.com/verify-email?userId=${user.$id}&token=${verificationToken}`;

    await sgMail.send({
      to: email,
      from: 'sailemaastokaty@gmail.com',
      subject: 'Verifica tu cuenta - Control Electoral Ecuador',
      html: `
        <p>Hola${user.name ? ` ${user.name}` : ''},</p>
        <p>Recibimos una solicitud para reenviar el enlace de verificación de tu cuenta.</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}"
            style="background-color:#1a56db;color:#ffffff;padding:12px 24px;
                    text-decoration:none;border-radius:6px;font-weight:bold;
                    display:inline-block;">
            Verificar mi correo electrónico
          </a>
        </p>
        <p style="font-size:12px;color:#666;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
          ${verifyUrl}
        </p>`
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('Error reenviando verificación:', e);
    res.status(500).json({ error: 'Error al reenviar el correo' });
  }
});

app.post('/api/solicitar-reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta el correo electrónico' });

  try {
    const userList = await users.list([Query.equal('email', email)]);

    if (userList.total === 0) {
      return res.json({ ok: true });
    }

    const user = userList.users[0];
    const existingPrefs = await users.getPrefs(user.$id);

    const resetToken = crypto.randomBytes(32).toString('hex');
    await users.updatePrefs(user.$id, {
      ...existingPrefs,
      reset_token: resetToken,
      reset_created_at: Date.now(),
    });

    const resetUrl = `https://control-electoral.onrender.com/reset-password?userId=${user.$id}&token=${resetToken}`;

    await sgMail.send({
      to: email,
      from: 'sailemaastokaty@gmail.com',
      subject: 'Restablecer contraseña - Control Electoral Ecuador',
      html: `
        <p>Hola,</p>
        <p>Recibimos una solicitud para restablecer tu contraseña en el sistema de Control Electoral.</p>
        <p>Si fuiste tú, haz clic en el siguiente botón para crear una nueva contraseña:</p>
        <p style="margin: 24px 0;">
          <a href="${resetUrl}"
            style="background-color:#1a56db;color:#ffffff;padding:12px 24px;
                    text-decoration:none;border-radius:6px;font-weight:bold;
                    display:inline-block;">
            Restablecer mi contraseña
          </a>
        </p>
        <p style="font-size:12px;color:#666;">
          Si no solicitaste este cambio, puedes ignorar este correo. El enlace expira en 1 hora.
        </p>
        <p style="font-size:12px;color:#666;">
          Si el botón no funciona, copia y pega este enlace en tu navegador:<br>
          ${resetUrl}
        </p>`
    });

    res.json({ ok: true });
  } catch (e) {
    console.error('Error solicitando reset de password:', e);
    res.status(500).json({ error: 'Error al procesar la solicitud' });
  }
});

app.post('/api/confirmar-reset-password', async (req, res) => {
  const { userId, token, newPassword } = req.body;

  if (!userId || !token || !newPassword) {
    return res.status(400).json({ error: 'Faltan datos' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });
  }

    try {
    const prefs = await users.getPrefs(userId);

    if (!prefs.reset_token || prefs.reset_token !== token) {
      return res.status(400).json({ error: 'Enlace inválido o ya utilizado' });
    }

    const createdAt = Number(prefs.reset_created_at) || 0;
    const EXPIRY_MS = 5 * 60 * 1000;
    if (Date.now() - createdAt > EXPIRY_MS) {
      return res.status(400).json({ error: 'El enlace ha expirado. Solicita uno nuevo.' });
    }

    await users.updatePassword(userId, newPassword);

    const { reset_token, reset_created_at, ...restPrefs } = prefs;
    await users.updatePrefs(userId, restPrefs);

    res.json({ ok: true });
  } catch (e) {
    console.error('Error confirmando reset password:', e);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/usuarios', async (req, res) => {
  const { email, password, name, phone, rol, cedula, telefono, nombres, apellidos, } = req.body;

  if (!email || !password || !rol) {
    return res.status(400).json({ error: 'Faltan email, password o rol' });
  }

  const teamId = TEAM_IDS[rol];
  if (!teamId) {
    return res.status(400).json({ error: `Rol '${rol}' no tiene team configurado` });
  }

  let createdUserId = null;

  try {
    const user = await users.create(ID.unique(), email, phone ?? null, password, name);
    createdUserId = user.$id;
    await teams.createMembership(
      teamId,
      ['member'],
      undefined,
      createdUserId,
    );
    
    const perfil = await databases.createDocument(
      DATABASE_ID,
      COLLECTION_PERFILES,
      ID.unique(),
      {
        user_id: createdUserId,
        cedula,
        nombres,
        apellidos,
        telefono,
        email,
        rol,
        primer_login: true,
        activo: true,
      }
    );

    res.json({ ok: true, userId: createdUserId, perfilId: perfil.$id });

  } catch (e) {
    console.error('Error creando usuario:', e);
    if (createdUserId) {
      try {
        await users.delete(createdUserId);
        console.log('Rollback: usuario eliminado por fallo posterior', createdUserId);
      } catch (rollbackErr) {
        console.error('Error en rollback:', rollbackErr);
      }
    }
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
