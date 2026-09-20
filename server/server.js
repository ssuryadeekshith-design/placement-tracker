const admin = require('firebase-admin');
const express = require('express');
const cors = require('cors');
const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
    console.log(`📥 Incoming ${req.method} request to: ${req.url}`);
    next();
});

try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin Initialized");
} catch (error) {
    console.error("❌ Firebase Error:", error.message);
}

const db = admin.firestore();

app.get('/api/students', async (req, res) => {
    try {
        const snapshot = await db.collection('Students').get();
        const list = snapshot.docs.map(doc => doc.data());
        res.json(list);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/events', async (req, res) => {
    try {
        const snapshot = await db.collection('Events').get();
        res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/events', async (req, res) => {
    try {
        console.log("Creating event with data:", req.body);
        const eventData = { ...req.body, createdAt: new Date() };
        const docRef = await db.collection('Events').add(eventData);
        res.json({ id: docRef.id, ...eventData });
    } catch (err) { 
        console.error("Error creating event:", err.message);
        res.status(500).json({ error: err.message }); 
    }
});

app.post('/api/attendance', async (req, res) => {
    try {
        const { eventId, rollNumber } = req.body;
        const logId = `${eventId}_${rollNumber}`;
        await db.collection('AttendanceLogs').doc(logId).set({
            eventId,
            rollNumber,
            timestamp: new Date()
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/attendance-summary', async (req, res) => {
    try {
        const attendanceSnap = await db.collection('AttendanceLogs').get();
        const eventsSnap = await db.collection('Events').get(); 
        const logs = attendanceSnap.docs.map(d => d.data());
        res.json({ logs, mandatoryCount: eventsSnap.size });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

const importExcelData = async () => {
    const filePath = path.join(__dirname, 'students.xlsx');
    if (!fs.existsSync(filePath)) return;

    const workbook = xlsx.readFile(filePath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    if (rows.length === 0) return;

    let headerRowIndex = -1;
    let rollCol = -1;
    let nameCol = -1;
    let emailCol = -1;

    for (let i = 0; i < Math.min(rows.length, 5); i++) {
        const row = rows[i];
        if (!row) continue;
        const rowString = row.map(cell => String(cell || '').toLowerCase());
        const foundRoll = rowString.findIndex(c => c.includes('roll') || c.includes('id') || c.includes('reg'));
        const foundName = rowString.findIndex(c => c.includes('name') || c.includes('student'));

        if (foundRoll !== -1 || foundName !== -1) {
            headerRowIndex = i;
            rollCol = foundRoll;
            nameCol = foundName;
            emailCol = rowString.findIndex(c => c.includes('mail') || c.includes('e-mail'));
            break;
        }
    }

    if (headerRowIndex === -1) return;

    const batch = db.batch();
    let count = 0;

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row) continue;

        const roll = rollCol !== -1 ? row[rollCol] : null;
        const name = nameCol !== -1 ? row[nameCol] : null;
        const email = emailCol !== -1 ? row[emailCol] : null;

        if (roll) {
            const cleanRoll = roll.toString().trim();
            const ref = db.collection('Students').doc(cleanRoll);
            batch.set(ref, { 
                rollNumber: cleanRoll, 
                fullName: name ? name.toString().trim() : "Unknown", 
                email: email ? email.toString().trim() : "" 
            }, { merge: true });
            count++;
        }
    }

    await batch.commit();
    console.log(`✅ Successfully synced ${count} students to Firestore!`);
};

// FORCED PORT 5001
const PORT = 5001;
app.listen(PORT, () => {
    console.log(`🚀 Backend running on http://127.0.0.1:${PORT}`);
    importExcelData();
});
