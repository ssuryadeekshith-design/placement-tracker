import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Calendar, CheckCircle, TrendingUp, Lock, ArrowLeft } from 'lucide-react';

const API = "https://placement-tracker-lyjf.onrender.com/api";

function App() {
  const [view, setView] = useState('student');
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [mandatoryEventCount, setMandatoryEventCount] = useState(0);
  
  // Student Portal State (Cohort + Suffix search)
  const [studentCohort, setStudentCohort] = useState('IPM');
  const [searchRoll, setSearchRoll] = useState("");
  const [loggedInStudent, setLoggedInStudent] = useState(null);

  // Admin Check-in State
  const [newTrack, setNewTrack] = useState({ eventId: '', cohort: 'IPM', shortId: '' });
  const [newEvent, setNewEvent] = useState({ title: '', date: '', isMandatory: true });

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    try {
      const resStudents = await axios.get(`${API}/students`);
      const resEvents = await axios.get(`${API}/events`);
      const resAttendance = await axios.get(`${API}/attendance-summary`);
      setStudents(resStudents.data);
      setEvents(resEvents.data);
      setAttendanceLogs(resAttendance.data.logs);
      setMandatoryEventCount(resAttendance.data.mandatoryCount);
    } catch (e) { console.error("Fetch error", e); }
  };

  const calculateAttendance = (rollNumber) => {
    const attended = attendanceLogs.filter(log => log.rollNumber === rollNumber).length;
    const percentage = mandatoryEventCount === 0 ? 100 : (attended / mandatoryEventCount) * 100;
    return percentage.toFixed(1);
  };

  // Smart Student Login: Uses Cohort + Suffix (e.g. IPM + 9 matches 2023-5IPM-09)
  const handleStudentLogin = () => {
    const cleanInput = searchRoll.trim();
    if (!cleanInput) {
      alert("Please enter your roll number ID.");
      return;
    }

    const matchedStudent = students.find(s => {
      const rollUpper = s.rollNumber.toUpperCase();
      const matchesGroup = rollUpper.includes(studentCohort);
      const matchesSuffix = rollUpper.endsWith('-' + cleanInput) || 
                            rollUpper.endsWith('-0' + cleanInput) ||
                            rollUpper === cleanInput;
      return matchesGroup && matchesSuffix;
    });

    if (matchedStudent) {
      setLoggedInStudent(matchedStudent);
    } else {
      alert(`❌ No ${studentCohort} student found matching ID: "${cleanInput}"`);
    }
  };

  const triggerAdminLogin = () => {
    const passcode = prompt("Enter Placement Committee Admin Passcode:");
    if (passcode === "Psd2026") {
      setIsAdminAuthenticated(true);
      setView('admin');
    } else if (passcode !== null) {
      alert("Incorrect Admin Passcode!");
    }
  };

  const markAttendance = async (e) => {
    e.preventDefault();
    if (!newTrack.eventId || !newTrack.cohort || !newTrack.shortId) {
      alert("Please select an event, choose IPM/MBA, and enter the roll number suffix.");
      return;
    }

    const cleanInput = newTrack.shortId.trim();

    const matchedStudent = students.find(s => {
      const rollUpper = s.rollNumber.toUpperCase();
      const matchesGroup = rollUpper.includes(newTrack.cohort);
      const matchesSuffix = rollUpper.endsWith('-' + cleanInput) || 
                            rollUpper.endsWith('-0' + cleanInput) ||
                            rollUpper === cleanInput;
      return matchesGroup && matchesSuffix;
    });

    if (!matchedStudent) {
      alert(`❌ No ${newTrack.cohort} student found ending with ID: "${cleanInput}"`);
      return;
    }

    try {
      await axios.post(`${API}/attendance`, {
        eventId: newTrack.eventId,
        rollNumber: matchedStudent.rollNumber
      });
      alert(`✅ Marked Present: ${matchedStudent.fullName} (${matchedStudent.rollNumber})`);
      setNewTrack({ ...newTrack, shortId: '' });
      fetchData();
    } catch (err) {
      alert("Error marking attendance");
    }
  };

  const createEvent = async (e) => {
    e.preventDefault();
    if (!newEvent.title || !newEvent.date) {
      alert("Please provide a title and date.");
      return;
    }
    await axios.post(`${API}/events`, newEvent);
    alert("New Placement Event Created!");
    fetchData();
  };

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif', padding: '20px', backgroundColor: '#f0f2f5', minHeight: '100vh' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', background: '#1a365d', padding: '20px', borderRadius: '12px', color: '#fff' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>TPAC</h1>
          <p style={{ margin: 0, opacity: 0.8 }}>University Placement Cell</p>
        </div>
        <div>
          {view === 'admin' ? (
            <button onClick={() => { setView('student'); setLoggedInStudent(null); }} style={{ padding: '10px 20px', cursor: 'pointer', background: '#e74c3c', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>
              Exit Admin Panel
            </button>
          ) : (
            <button onClick={triggerAdminLogin} style={{ padding: '10px 15px', cursor: 'pointer', background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <Lock size={16} /> Admin Login
            </button>
          )}
        </div>
      </header>

      {view === 'admin' && isAdminAuthenticated ? (
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '25px' }}>
          <aside>
            <div style={{ background: '#fff', padding: '25px', borderRadius: '12px', marginBottom: '25px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ marginTop: 0 }}><Calendar size={20} /> Create New Event</h3>
              <input type="text" placeholder="Company Name / Drive Title" autoComplete="off" style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewEvent({...newEvent, title: e.target.value})} />
              <input type="date" style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewEvent({...newEvent, date: e.target.value})} />
              <button onClick={createEvent} style={{ width: '100%', padding: '12px', background: '#2ecc71', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Add Event</button>
            </div>

            <div style={{ background: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ marginTop: 0 }}><CheckCircle size={20} /> Smart Check-In</h3>
              <select style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} value={newTrack.eventId} onChange={(e) => setNewTrack({...newTrack, eventId: e.target.value})}>
                <option value="">Select Event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
              </select>

              <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#555', display: 'block', marginBottom: '5px' }}>Select Cohort:</label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
                <button type="button" onClick={() => setNewTrack({...newTrack, cohort: 'IPM'})} style={{ flex: 1, padding: '10px', background: newTrack.cohort === 'IPM' ? '#2980b9' : '#ecf0f1', color: newTrack.cohort === 'IPM' ? '#fff' : '#333', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>IPM</button>
                <button type="button" onClick={() => setNewTrack({...newTrack, cohort: 'MBA'})} style={{ flex: 1, padding: '10px', background: newTrack.cohort === 'MBA' ? '#2980b9' : '#ecf0f1', color: newTrack.cohort === 'MBA' ? '#fff' : '#333', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>MBA</button>
              </div>

              <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#555', display: 'block', marginBottom: '5px' }}>Roll Number Suffix / ID:</label>
              <input type="text" placeholder="e.g. 9 or 60" autoComplete="off" value={newTrack.shortId} style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewTrack({...newTrack, shortId: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && markAttendance(e)} />
              
              <button onClick={markAttendance} style={{ width: '100%', padding: '12px', background: '#3498db', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Mark Present</button>
            </div>
          </aside>

          <main style={{ background: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ marginTop: 0 }}>Master Student Roster ({students.length} Students)</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', background: '#f8f9fa' }}>
                  <th style={{ padding: '15px' }}>Roll Number</th>
                  <th>Full Name</th>
                  <th>Attendance %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {students.map(s => {
                  const percent = calculateAttendance(s.rollNumber);
                  return (
                    <tr key={s.rollNumber} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '15px', fontWeight: '500' }}>{s.rollNumber}</td>
                      <td>{s.fullName}</td>
                      <td>{percent}%</td>
                      <td>
                        {percent >= 95 ? <span style={{ color: '#27ae60', background: '#e8f6ef', padding: '5px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>EXCELLENT</span> : 
                         percent < 75 ? <span style={{ color: '#e74c3c', background: '#fdecea', padding: '5px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>WARNING</span> : 
                         <span style={{ color: '#f39c12', background: '#fef5e7', padding: '5px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>AVERAGE</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </main>
        </div>
      ) : (
        <div style={{ maxWidth: loggedInStudent ? '700px' : '450px', margin: '0 auto', transition: 'max-width 0.3s ease' }}>
          {!loggedInStudent ? (
            <div style={{ background: '#fff', padding: '40px', borderRadius: '15px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <TrendingUp size={40} color="#3498db" style={{ margin: '0 auto 15px auto' }} />
              <h2 style={{ marginTop: 0 }}>Student Portal</h2>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>Select your cohort and enter your roll number ID to check your attendance.</p>
              
              <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#555', display: 'block', textAlign: 'left', marginBottom: '5px' }}>Select Cohort:</label>
              <div style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <button type="button" onClick={() => setStudentCohort('IPM')} style={{ flex: 1, padding: '10px', background: studentCohort === 'IPM' ? '#2980b9' : '#ecf0f1', color: studentCohort === 'IPM' ? '#fff' : '#333', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>IPM</button>
                <button type="button" onClick={() => setStudentCohort('MBA')} style={{ flex: 1, padding: '10px', background: studentCohort === 'MBA' ? '#2980b9' : '#ecf0f1', color: studentCohort === 'MBA' ? '#fff' : '#333', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>MBA</button>
              </div>

              <label style={{ fontSize: '13px', fontWeight: 'bold', color: '#555', display: 'block', textAlign: 'left', marginBottom: '5px' }}>Roll Number Suffix / ID:</label>
              <input type="text" placeholder="e.g. 9 or 60" autoComplete="off" style={{ padding: '12px', width: '100%', boxSizing: 'border-box', borderRadius: '6px', border: '1px solid #ddd', fontSize: '16px', marginBottom: '15px' }} value={searchRoll} onChange={(e)=>setSearchRoll(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleStudentLogin()} />
              
              <button onClick={handleStudentLogin} style={{ padding: '12px', width: '100%', background: '#3498db', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '16px' }}>Check Attendance</button>
            </div>
          ) : (
            <div style={{ background: '#fff', padding: '40px', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <button onClick={() => setLoggedInStudent(null)} style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '16px', fontWeight: 'bold' }}><ArrowLeft size={18} /> Search Another ID</button>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{loggedInStudent.fullName}</h2>
                  <p style={{ margin: 0, color: '#666' }}>Roll No: {loggedInStudent.rollNumber} | {loggedInStudent.email}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '40px', fontWeight: 'bold', color: calculateAttendance(loggedInStudent.rollNumber) >= 75 ? '#27ae60' : '#e74c3c' }}>
                    {calculateAttendance(loggedInStudent.rollNumber)}%
                  </div>
                  <p style={{ margin: 0, fontWeight: 'bold', color: '#666' }}>Overall Attendance</p>
                </div>
              </div>
              
              <div style={{ marginTop: '30px' }}>
                <h3>Event History</h3>
                {attendanceLogs.filter(l => l.rollNumber === loggedInStudent.rollNumber).length > 0 ? (
                  attendanceLogs.filter(l => l.rollNumber === loggedInStudent.rollNumber).map((log, i) => (
                    <div key={i} style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span><strong>Event:</strong> {events.find(e => e.id === log.eventId)?.title || "Placement Drive"}</span>
                      <span style={{ color: '#27ae60', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 'bold' }}><CheckCircle size={16} /> Present</span>
                    </div>
                  ))
                ) : (
                  <p style={{ color: '#666', fontStyle: 'italic' }}>No attendance logs recorded yet for this student.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;