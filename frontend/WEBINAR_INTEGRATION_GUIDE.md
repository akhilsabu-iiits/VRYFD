# Webinar Integration & Enhanced Event Management - Implementation Guide

This guide documents the frontend components created for webinar integration and enhanced event management features.

## ✅ Completed Components

### 1. **Dependencies Added** (`package.json`)
- `recharts`: ^2.12.0 - For attendance charts and visualizations
- `react-hook-form`: ^7.51.0 - For form management
- `zod`: ^3.22.0 - For form validation
- `@hookform/resolvers`: ^3.3.0 - Zod resolver for react-hook-form

### 2. **Updated ABI** (`src/abis/VryfdAttendance.json`)
- Copied from backend with all new contract functions
- Includes webinar attendance tracking functions
- Certificate eligibility checking functions

### 3. **Attendance Hooks** (`src/hooks/useAttendance.ts`)

#### `useWebinarTracking(eventId, isActive)`
- Auto-tracks join/leave events
- Sends heartbeat every 30 seconds
- Returns: `{ isTracking, error, trackJoin, trackLeave }`

#### `useAttendanceDetails(eventId, attendee?)`
- Fetches attendance record for a user
- Returns: `{ attendance, isLoading, error, refetch }`

#### `useEventStatistics(eventId)`
- Fetches real-time event statistics
- Polls every 10 seconds
- Returns: `{ statistics, isLoading, error, refetch }`

#### `useEligibleAttendees(eventId)`
- Fetches list of eligible attendees
- Returns: `{ attendees, isLoading, error, refetch }`

#### `useSubmitAttendance()`
- Submits attendance to blockchain
- Returns: `{ submitAttendance, isSubmitting, error }`

### 4. **WebinarPage Component** (`src/components/WebinarPage.tsx`)

Full-screen webinar interface with:
- **Jitsi Meet iframe embed** - Displays webinar video
- **Real-time attendance tracker sidebar** showing:
  - Tracking status (active/idle)
  - Time in session (HH:MM:SS format)
  - Attendance percentage
  - Progress bar with threshold marker
  - Eligibility status
  - Event details (duration, threshold, required time)
- **Auto-tracking** - Automatically tracks join/leave
- **Responsive design** - Works on desktop and mobile

**Props:**
```typescript
{
  eventId: number;
  eventName: string;
  eventEmoji: string;
  webinarUrl: string;
  duration: number; // minutes
  attendanceThreshold: number; // percentage
  onClose: () => void;
}
```

### 5. **CreateEventForm Component** (`src/components/CreateEventForm.tsx`)

Multi-step wizard for event creation:

**Step 1: Basic Information**
- Event name (validated, 3-100 chars)
- Emoji selector (12 options)
- Color picker (6 colors)
- Start/End date pickers

**Step 2: Event Type & Details**
- Event type selector (Physical/Virtual/Hybrid)
- Webinar URL (required for Virtual/Hybrid)
- Duration in minutes (required for Virtual/Hybrid)

**Step 3: Attendance Settings**
- Attendance threshold slider (1-100%)
- Claim period (1-365 days)
- Event summary preview

**Features:**
- Form validation with Zod
- Progress indicator
- Responsive design
- Error handling

**Props:**
```typescript
{
  onSubmit: (data: EventFormData) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}
```

**EventFormData Type:**
```typescript
{
  name: string;
  emoji: string;
  color: string;
  eventType: 'virtual' | 'physical' | 'hybrid';
  startDate: string;
  endDate: string;
  attendanceThreshold: number;
  claimPeriodDays: number;
  duration?: number;
  webinarUrl?: string;
}
```

## 📝 Required Updates to Existing Components

### 6. **OrganizerPage Updates** (`src/components/OrganizerPage.tsx`)

Add these features to the existing component:

#### A. Add "Create Event" Button
```typescript
// Add state for form modal
const [showCreateForm, setShowCreateForm] = useState(false);

// Add button in header
<button 
  type="button" 
  className="btn btn-primary"
  onClick={() => setShowCreateForm(true)}
>
  ✏️ Create Event
</button>

// Add modal
{showCreateForm && (
  <CreateEventForm
    onSubmit={handleCreateEvent}
    onCancel={() => setShowCreateForm(false)}
    isSubmitting={isCreating}
  />
)}
```

#### B. Add Live Attendance Dashboard
In the "Attendance" tab, add:

```typescript
import { useEventStatistics, useEligibleAttendees } from '../hooks/useAttendance';

// In component
const { statistics } = useEventStatistics(selectedEventId);
const { attendees: eligibleList } = useEligibleAttendees(selectedEventId);

// Display statistics
<div className="attendance-stats">
  <div className="stat-card">
    <div className="stat-value">{statistics?.currentParticipants || 0}</div>
    <div className="stat-label">Current Participants</div>
  </div>
  <div className="stat-card">
    <div className="stat-value">{statistics?.eligibleCount || 0}</div>
    <div className="stat-label">Eligible for Certificate</div>
  </div>
  <div className="stat-card">
    <div className="stat-value">{statistics?.averageAttendance.toFixed(1)}%</div>
    <div className="stat-label">Average Attendance</div>
  </div>
</div>
```

#### C. Add Attendance Distribution Chart
```typescript
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

<ResponsiveContainer width="100%" height={300}>
  <BarChart data={statistics?.attendanceDistribution || []}>
    <CartesianGrid strokeDasharray="3 3" />
    <XAxis dataKey="range" />
    <YAxis />
    <Tooltip />
    <Bar dataKey="count" fill="var(--accent2)" />
  </BarChart>
</ResponsiveContainer>
```

#### D. Add "Submit Attendance to Blockchain" Button
```typescript
import { useSubmitAttendance } from '../hooks/useAttendance';

const { submitAttendance, isSubmitting } = useSubmitAttendance();

const handleBatchSubmit = async () => {
  const addresses = eligibleList.map(a => a.address);
  await submitAttendance(selectedEventId, addresses);
  onToast('Attendance submitted to blockchain!', 'success');
};

<button
  type="button"
  className="btn btn-primary"
  onClick={handleBatchSubmit}
  disabled={isSubmitting || eligibleList.length === 0}
>
  {isSubmitting ? 'Submitting...' : '⛓ Submit Attendance to Blockchain'}
</button>
```

#### E. Display Eligible vs Ineligible Attendees
```typescript
<div className="attendee-lists">
  <div className="eligible-list">
    <h4>✅ Eligible ({eligibleList.filter(a => a.isEligible).length})</h4>
    {eligibleList.filter(a => a.isEligible).map(attendee => (
      <div key={attendee.address} className="attendee-item">
        <span>{attendee.ens || attendee.address}</span>
        <span className="attendance-badge">{attendee.attendancePercentage.toFixed(1)}%</span>
      </div>
    ))}
  </div>
  
  <div className="ineligible-list">
    <h4>⏳ Not Eligible ({eligibleList.filter(a => !a.isEligible).length})</h4>
    {eligibleList.filter(a => !a.isEligible).map(attendee => (
      <div key={attendee.address} className="attendee-item">
        <span>{attendee.ens || attendee.address}</span>
        <span className="attendance-badge">{attendee.attendancePercentage.toFixed(1)}%</span>
      </div>
    ))}
  </div>
</div>
```

### 7. **EventsPage Updates** (`src/components/EventsPage.tsx`)

Add these features to the existing component:

#### A. Show Event Type Badge
```typescript
// In event list item
<span className={`event-type-badge ${event.eventType}`}>
  {event.eventType === 'virtual' ? '💻' : event.eventType === 'hybrid' ? '🌐' : '🏢'}
  {event.eventType}
</span>
```

#### B. Add "Join Webinar" Button for Virtual Events
```typescript
const [activeWebinar, setActiveWebinar] = useState<number | null>(null);

// In event panel, for virtual/hybrid events
{(ev.eventType === 'virtual' || ev.eventType === 'hybrid') && ev.status === 'live' && (
  <button
    type="button"
    className="btn btn-primary btn-block"
    onClick={() => setActiveWebinar(ev.id)}
  >
    💻 Join Webinar
  </button>
)}

// Add WebinarPage modal
{activeWebinar && (
  <WebinarPage
    eventId={activeWebinar}
    eventName={events.find(e => e.id === activeWebinar)?.name || ''}
    eventEmoji={events.find(e => e.id === activeWebinar)?.emoji || ''}
    webinarUrl={events.find(e => e.id === activeWebinar)?.webinarUrl || ''}
    duration={events.find(e => e.id === activeWebinar)?.duration || 60}
    attendanceThreshold={events.find(e => e.id === activeWebinar)?.attendanceThreshold || 75}
    onClose={() => setActiveWebinar(null)}
  />
)}
```

#### C. Display Attendance Threshold and Claim Period
```typescript
// In event details section
<div className="event-requirements">
  <div className="requirement-item">
    <span className="requirement-label">Attendance Required:</span>
    <span className="requirement-value">{ev.attendanceThreshold}%</span>
  </div>
  <div className="requirement-item">
    <span className="requirement-label">Claim Period:</span>
    <span className="requirement-value">{ev.claimPeriodDays} days</span>
  </div>
</div>
```

#### D. Show User's Current Attendance Percentage
```typescript
import { useAttendanceDetails } from '../hooks/useAttendance';

const { attendance } = useAttendanceDetails(currentEventId);

// Display in event panel
{attendance && (
  <div className="user-attendance-card">
    <div className="attendance-progress">
      <div className="progress-header">
        <span>Your Attendance</span>
        <span className="progress-value">{attendance.attendancePercentage.toFixed(1)}%</span>
      </div>
      <div className="progress-bar">
        <div 
          className="progress-fill"
          style={{ 
            width: `${attendance.attendancePercentage}%`,
            backgroundColor: attendance.attendancePercentage >= ev.attendanceThreshold ? 'var(--green)' : 'var(--amber)'
          }}
        />
      </div>
      <div className="progress-footer">
        <span>Time: {Math.floor(attendance.duration / 60)} min</span>
        <span>Required: {ev.attendanceThreshold}%</span>
      </div>
    </div>
  </div>
)}
```

#### E. Show Eligibility Status
```typescript
{attendance && (
  <div className={`eligibility-badge ${attendance.attendancePercentage >= ev.attendanceThreshold ? 'eligible' : 'not-eligible'}`}>
    {attendance.attendancePercentage >= ev.attendanceThreshold ? (
      <>✅ Eligible for Certificate</>
    ) : (
      <>⏳ {(ev.attendanceThreshold - attendance.attendancePercentage).toFixed(1)}% more needed</>
    )}
  </div>
)}
```

### 8. **Dashboard Updates** (`src/components/Dashboard.tsx`)

Add these features to the existing component:

#### A. Add Attendance Statistics Widget
```typescript
// Add new stat card
<div className="card stat-card">
  <div className="stat-icon" style={{ background: "rgba(96,165,250,0.12)", color: "var(--blue)" }}>📊</div>
  <div className="stat-value">{userAttendanceAvg.toFixed(1)}%</div>
  <div className="stat-label">Avg Attendance</div>
</div>
```

#### B. Show Events by Type
```typescript
const virtualEvents = events.filter(e => e.eventType === 'virtual');
const physicalEvents = events.filter(e => e.eventType === 'physical');
const hybridEvents = events.filter(e => e.eventType === 'hybrid');

<div className="event-type-stats">
  <div className="type-stat">
    <span className="type-icon">💻</span>
    <span className="type-count">{virtualEvents.length}</span>
    <span className="type-label">Virtual</span>
  </div>
  <div className="type-stat">
    <span className="type-icon">🏢</span>
    <span className="type-count">{physicalEvents.length}</span>
    <span className="type-label">Physical</span>
  </div>
  <div className="type-stat">
    <span className="type-icon">🌐</span>
    <span className="type-count">{hybridEvents.length}</span>
    <span className="type-label">Hybrid</span>
  </div>
</div>
```

#### C. Display Upcoming Webinars
```typescript
const upcomingWebinars = events.filter(e => 
  (e.eventType === 'virtual' || e.eventType === 'hybrid') && 
  e.status === 'upcoming'
);

<div className="section-header fade-up">
  <span className="section-title">Upcoming Webinars</span>
</div>
<div className="grid grid-2 fade-up">
  {upcomingWebinars.map(ev => (
    <div key={ev.id} className="card webinar-card">
      <div className="webinar-type-badge">💻 Virtual</div>
      <div className="event-name">{ev.emoji} {ev.name}</div>
      <div className="event-meta">{ev.date}</div>
      <div className="webinar-info">
        <span>Duration: {ev.duration} min</span>
        <span>Threshold: {ev.attendanceThreshold}%</span>
      </div>
    </div>
  ))}
</div>
```

#### D. Show Attendance Progress for Ongoing Events
```typescript
import { useAttendanceDetails } from '../hooks/useAttendance';

const ongoingEvents = events.filter(e => e.status === 'live');

<div className="section-header fade-up">
  <span className="section-title">Your Ongoing Events</span>
</div>
<div className="ongoing-events-list">
  {ongoingEvents.map(ev => {
    const { attendance } = useAttendanceDetails(ev.id);
    return (
      <div key={ev.id} className="ongoing-event-card">
        <div className="event-header">
          <span className="event-emoji">{ev.emoji}</span>
          <span className="event-name">{ev.name}</span>
        </div>
        {attendance && (
          <div className="attendance-mini-progress">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${attendance.attendancePercentage}%` }}
              />
            </div>
            <span className="progress-text">
              {attendance.attendancePercentage.toFixed(1)}% / {ev.attendanceThreshold}%
            </span>
          </div>
        )}
      </div>
    );
  })}
</div>
```

## 🎨 CSS Additions

Add these styles to `src/app/globals.css`:

```css
/* Webinar Page Styles */
.webinar-page-overlay { /* Already in WebinarPage.tsx as inline styles */ }

/* Create Event Form Styles */
.create-event-overlay { /* Already in CreateEventForm.tsx as inline styles */ }

/* Event Type Badges */
.event-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
}

.event-type-badge.virtual {
  background: rgba(96, 165, 250, 0.1);
  color: var(--blue);
  border: 1px solid rgba(96, 165, 250, 0.3);
}

.event-type-badge.physical {
  background: rgba(52, 211, 153, 0.1);
  color: var(--green);
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.event-type-badge.hybrid {
  background: rgba(251, 191, 36, 0.1);
  color: var(--amber);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

/* Attendance Progress */
.user-attendance-card {
  padding: 16px;
  background: var(--bg);
  border-radius: 8px;
  border: 1px solid var(--border);
  margin-top: 16px;
}

.attendance-progress .progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
}

.attendance-progress .progress-value {
  font-weight: 600;
  color: var(--text);
}

.attendance-progress .progress-bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 4px;
  overflow: hidden;
}

.attendance-progress .progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s ease;
}

.attendance-progress .progress-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

/* Eligibility Badge */
.eligibility-badge {
  padding: 12px;
  border-radius: 8px;
  text-align: center;
  font-size: 14px;
  font-weight: 500;
  margin-top: 12px;
}

.eligibility-badge.eligible {
  background: rgba(52, 211, 153, 0.1);
  color: var(--green);
  border: 1px solid rgba(52, 211, 153, 0.3);
}

.eligibility-badge.not-eligible {
  background: rgba(251, 191, 36, 0.1);
  color: var(--amber);
  border: 1px solid rgba(251, 191, 36, 0.3);
}

/* Event Type Stats */
.event-type-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-bottom: 24px;
}

.type-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
  background: var(--card-bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.type-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.type-count {
  font-size: 24px;
  font-weight: 600;
  color: var(--text);
}

.type-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* Ongoing Events */
.ongoing-events-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ongoing-event-card {
  padding: 16px;
  background: var(--card-bg);
  border-radius: 8px;
  border: 1px solid var(--border);
}

.ongoing-event-card .event-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.ongoing-event-card .event-emoji {
  font-size: 24px;
}

.ongoing-event-card .event-name {
  font-size: 16px;
  font-weight: 500;
  color: var(--text);
}

.attendance-mini-progress .progress-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 8px;
}

.attendance-mini-progress .progress-fill {
  height: 100%;
  background: var(--accent2);
  border-radius: 3px;
}

.attendance-mini-progress .progress-text {
  font-size: 12px;
  color: var(--text-muted);
}
```

## 🔧 Type Definitions

Add to `src/lib/vryfd.ts`:

```typescript
export interface VEvent {
  id: number;
  name: string;
  emoji: string;
  color: string;
  date: string;
  status: 'live' | 'upcoming' | 'ended';
  attendees: number;
  startTime?: number;
  endTime?: number;
  joinCode?: string;
  deployTxHash?: string;
  // New fields
  eventType?: 'virtual' | 'physical' | 'hybrid';
  webinarUrl?: string;
  duration?: number; // minutes
  attendanceThreshold?: number; // percentage
  claimPeriodDays?: number;
}
```

## 📦 Installation

Run this command to install new dependencies:

```bash
cd VRYFD/frontend
npm install
```

## 🚀 Usage Examples

### Opening Webinar Page
```typescript
import WebinarPage from '../components/WebinarPage';

const [showWebinar, setShowWebinar] = useState(false);

{showWebinar && (
  <WebinarPage
    eventId={1}
    eventName="Web3 Summit"
    eventEmoji="🚀"
    webinarUrl="https://meet.jit.si/web3-summit"
    duration={120}
    attendanceThreshold={75}
    onClose={() => setShowWebinar(false)}
  />
)}
```

### Creating Event with Form
```typescript
import CreateEventForm from '../components/CreateEventForm';

const [showForm, setShowForm] = useState(false);

const handleCreateEvent = async (data) => {
  console.log('Creating event:', data);
  // Call backend API to create event
  await createEvent(data);
  setShowForm(false);
};

{showForm && (
  <CreateEventForm
    onSubmit={handleCreateEvent}
    onCancel={() => setShowForm(false)}
  />
)}
```

## 🔗 Backend API Endpoints Required

Ensure these endpoints exist in your backend:

- `POST /api/attendance/webinar/join` - Track webinar join
- `POST /api/attendance/webinar/leave` - Track webinar leave
- `POST /api/attendance/webinar/heartbeat` - Keep session alive
- `GET /api/attendance/details/:eventId/:attendee` - Get attendance details
- `GET /api/attendance/statistics/:eventId` - Get event statistics
- `GET /api/attendance/eligible/:eventId` - Get eligible attendees
- `POST /api/attendance/submit` - Submit attendance to blockchain

## ✅ Testing Checklist

- [ ] Install dependencies: `npm install`
- [ ] Test WebinarPage component with mock data
- [ ] Test CreateEventForm validation
- [ ] Test attendance hooks with backend API
- [ ] Update OrganizerPage with new features
- [ ] Update EventsPage with webinar integration
- [ ] Update Dashboard with attendance stats
- [ ] Test responsive design on mobile
- [ ] Test real-time attendance tracking
- [ ] Test blockchain submission

## 📚 Additional Resources

- [React Hook Form Documentation](https://react-hook-form.com/)
- [Zod Validation](https://zod.dev/)
- [Recharts Documentation](https://recharts.org/)
- [Jitsi Meet API](https://jitsi.github.io/handbook/docs/dev-guide/dev-guide-iframe/)

---

**Note:** The TypeScript errors shown during file creation are expected and will resolve once dependencies are installed with `npm install`.
