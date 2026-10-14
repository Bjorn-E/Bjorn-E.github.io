// Lists and settings used throughout the app. Change these to fit your team.
window.TO = window.TO || {};

TO.config = {
  appName: 'Bear with me',
  dataFormat: 1,

  // Workflow: Jira-like default. "done" statuses count as completed and lock
  // the task. "auto" statuses are set by the app, not chosen by hand:
  // a task needing review goes to In Review when marked Done, to Done when
  // the review is approved, and back to In Progress if changes are requested.
  statuses: [
    { id: 'todo',       name: 'To Do',       color: '#6b7280' },
    { id: 'inprogress', name: 'In Progress', color: '#2563eb' },
    { id: 'review',     name: 'In Review',   color: '#9333ea', auto: true },
    { id: 'onhold',     name: 'On Hold',     color: '#d97706' },
    { id: 'done',       name: 'Done',        color: '#16a34a', done: true },
    { id: 'cancelled',  name: 'Cancelled',   color: '#9ca3af', done: true }
  ],

  severities: [
    { id: 'critical', name: 'Critical', color: '#dc2626' },
    { id: 'high',     name: 'High',     color: '#ea580c' },
    { id: 'medium',   name: 'Medium',   color: '#ca8a04' },
    { id: 'low',      name: 'Low',      color: '#65a30d' }
  ],

  sources: ['Internal', 'External'],

  // Links between tasks. A link is stored on one task; the other task shows
  // it with the "inverse" wording.
  linkTypes: [
    { id: 'relates',    name: 'relates to',    inverse: 'relates to' },
    { id: 'blocks',     name: 'blocks',        inverse: 'is blocked by' },
    { id: 'blockedby',  name: 'is blocked by', inverse: 'blocks' },
    { id: 'duplicates', name: 'duplicates',    inverse: 'is duplicated by' }
  ],

  // Review result for tasks that need a review.
  reviewStatuses: [
    { id: 'pending',  name: 'Review pending',    color: '#6b7280' },
    { id: 'changes',  name: 'Changes requested', color: '#d97706' },
    { id: 'approved', name: 'Reviewed ✓',        color: '#16a34a' }
  ],

  // Roles. Admin: everything. Member: create and edit tasks (only the chosen
  // reviewer can set a review result). Viewer: read only.
  // These guard against mistakes; real protection needs folder permissions.
  roles: [
    { id: 'admin',  name: 'Admin' },
    { id: 'member', name: 'Member' },
    { id: 'viewer', name: 'Viewer (read only)' }
  ],

  // "Due soon" on the My work page means within this many days.
  dueSoonDays: 7,

  // Subject lines offered when notifying people by email.
  notifyTypes: [
    { id: 'assigned', name: 'New task assigned to you' },
    { id: 'updated',  name: 'Task updated' },
    { id: 'review',   name: 'Review requested' },
    { id: 'reminder', name: 'Reminder: delivery date' },
    { id: 'info',     name: 'For your information' }
  ],

  // Separator between email addresses in mailto links (Outlook uses ";").
  mailSeparator: ';',

  // How often (seconds) to look for changes made by other users.
  refreshSeconds: 20
};
