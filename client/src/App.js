import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Users, Calendar, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';

// Points directly to our live cloud backend on Render
const API = "https://placement-tracker-lyjf.onrender.com/api";
function App() {
  const [view, setView] = useState('admin');
  const [students, setStudents] = useState([]);
  const [events, setEvents] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [mandatoryEventCount, setMandatoryEventCount] = useState(0);
  
  const [searchRoll, setSearchRoll] = useState("");
  const [loggedInStudent, setLoggedInStudent] = useState(null);

  const [newTrack, setNewTrack] = useState({ eventId: '', rollNumber: '' });
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

  const handleStudentLogin = () => {
    const student = students.find(s => s.rollNumber.toLowerCase() === searchRoll.toLowerCase());
    if (student) { setLoggedInStudent(student); } 
    else { alert("Roll Number not found!"); }
  };

  const markAttendance = async (e) => {
    e.preventDefault();
    if (!newTrack.eventId || !newTrack.rollNumber) {
      alert("Please select an event and type a roll number.");
      return;
    }
    await axios.post(`${API}/attendance`, newTrack);
    alert(`Attendance marked for ${newTrack.rollNumber}`);
    setNewTrack({ ...newTrack, rollNumber: '' });
    fetchData();
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
          <h1 style={{ margin: 0, fontSize: '24px' }}>UniPlace Attendance Tracker</h1>
          <p style={{ margin: 0, opacity: 0.8 }}>University Placement Committee</p>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.1)', padding: '5px', borderRadius: '8px' }}>
          <button onClick={() => setView('admin')} style={{ padding: '10px 20px', cursor: 'pointer', background: view === 'admin' ? '#fff' : 'transparent', color: view === 'admin' ? '#1a365d' : '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>Admin Panel</button>
          <button onClick={() => setView('student')} style={{ padding: '10px 20px', cursor: 'pointer', background: view === 'student' ? '#fff' : 'transparent', color: view === 'student' ? '#1a365d' : '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold' }}>Student Portal</button>
        </div>
      </header>

      {view === 'admin' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '25px' }}>
          <aside>
            <div style={{ background: '#fff', padding: '25px', borderRadius: '12px', marginBottom: '25px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ marginTop: 0 }}><Calendar size={20} /> Create New Event</h3>
              <input type="text" placeholder="Company Name / Drive Title" style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewEvent({...newEvent, title: e.target.value})} />
              <input type="date" style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewEvent({...newEvent, date: e.target.value})} />
              <button onClick={createEvent} style={{ width: '100%', padding: '12px', background: '#2ecc71', color: '#fff', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Add Event</button>
            </div>

            <div style={{ background: '#fff', padding: '25px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
              <h3 style={{ marginTop: 0 }}><CheckCircle size={20} /> Attendance Check-in</h3>
              <select style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewTrack({...newTrack, eventId: e.target.value})}>
                <option value="">Select Event</option>
                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
              </select>
              <input type="text" placeholder="Scan or Type Roll No" value={newTrack.rollNumber} style={{ width: '100%', marginBottom: '12px', padding: '12px', borderRadius: '6px', border: '1px solid #ddd' }} onChange={(e) => setNewTrack({...newTrack, rollNumber: e.target.value})} />
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
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          {!loggedInStudent ? (
            <div style={{ background: '#fff', padding: '50px', borderRadius: '15px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <TrendingUp size={50} color="#3498db" />
              <h2>Student Login</h2>
              <p>Enter your unique Roll Number to view your attendance metrics</p>
              <input type="text" placeholder="Enter Roll Number" style={{ padding: '15px', width: '300px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '18px' }} value={searchRoll} onChange={(e)=>setSearchRoll(e.target.value)} />
              <button onClick={handleStudentLogin} style={{ padding: '15px 30px', marginLeft: '10px', background: '#3498db', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>View My Stats</button>
            </div>
          ) : (
            <div style={{ background: '#fff', padding: '40px', borderRadius: '15px', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}>
              <button onClick={() => setLoggedInStudent(null)} style={{ marginBottom: '20px', background: 'none', border: 'none', color: '#3498db', cursor: 'pointer' }}>← Back to Search</button>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #eee', paddingBottom: '20px' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{loggedInStudent.fullName}</h2>
                  <p style={{ margin: 0, color: '#666' }}>ID: {loggedInStudent.rollNumber} | {loggedInStudent.email}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '40px', fontWeight: 'bold', color: calculateAttendance(loggedInStudent.rollNumber) >= 75 ? '#27ae60' : '#e74c3c' }}>
                    {calculateAttendance(loggedInStudent.rollNumber)}%
                  </div>
                  <p style={{ margin: 0, fontWeight: 'bold', color: '#666' }}>Overall Attendance</p>
                </div>
              </div>
              
              <div style={{ marginTop: '30px' }}>
                <h3>Attendance History</h3>
                {attendanceLogs.filter(l => l.rollNumber === loggedInStudent.rollNumber).length > 0 ? (
                  attendanceLogs.filter(l => l.rollNumber === loggedInStudent.rollNumber).map((log, i) => (
                    <div key={i} style={{ padding: '15px', background: '#f8f9fa', borderRadius: '8px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
                      <span><strong>Event:</strong> {events.find(e => e.id === log.eventId)?.title}</span>
                      <span style={{ color: '#27ae60' }}><CheckCircle size={16} /> Present</span>
                    </div>
                  ))
                ) : (
                  <p>No attendance logs found for this student.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

App; // keep export default App
export default App;