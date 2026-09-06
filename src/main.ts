/**
 * Authority Park - Team Workspace Edition
 * 
 * Includes:
 * - Real-time Cloud Synchronization via Firebase Firestore
 * - Team Collaboration & Live Updates across all connected devices
 * - Task Assignment (Assign to specific team members)
 * - Assignee Filtering ("All", "My Tasks", or specific teammate)
 * - Admin Deletion Protection (Only rokonkhankb12@gmail.com / Admin can delete tasks)
 * - Dedicated Stopwatch & Allocated Target Time per task
 * - One-click "Share with Team" modal with direct link and instructions
 * - 100% offline fallback and local cache persistence
 */

import { db, auth, googleProvider, testFirestoreConnection } from './firebase';
import { 
  collection, 
  doc, 
  getDoc,
  setDoc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot 
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from 'firebase/auth';

// --- Types & Interfaces ---
export type PriorityLevel = 'Low' | 'Medium' | 'High';
export type TaskStatus = 'To Do' | 'In Progress' | 'Done';

export interface Task {
  id: string;
  title: string;
  priority: PriorityLevel;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  startDate?: string; // YYYY-MM-DD
  deadline?: string; // YYYY-MM-DD
  completedAt?: number; // timestamp when completed
  estimatedMinutes?: number;
  timeSpentSeconds: number;
  dailyLogs?: Record<string, number>; // date "YYYY-MM-DD" -> seconds worked
  isTimerRunning?: boolean;
  timerStartedAt?: number | null;
  assigneeName?: string;
  assigneeEmail?: string;
  assigneeId?: string;
  createdBy?: string;
  hiddenForUsers?: string[]; // user names or emails who removed this task from their account view
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  avatarColor?: string;
}

export interface TeamInvitation {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  invitedBy: string;
  invitedByName: string;
  status: 'pending' | 'accepted' | 'cancelled';
  createdAt: number;
}

export const OWNER_ADMIN_EMAIL = 'rokonkhankb12@gmail.com';
export const ADMIN_EMAIL = OWNER_ADMIN_EMAIL;

export const GUEST_USER: TeamMember = {
  id: 'guest_user',
  name: 'Visitor (টিম মেম্বার)',
  email: '',
  role: 'member',
  avatarColor: 'from-slate-500 to-slate-700',
};

// --- Initial Workspace Team Members ---
export const DEFAULT_TEAM_MEMBERS: TeamMember[] = [
  {
    id: 'member_rokon',
    name: 'Rokon Khan (Admin)',
    email: 'rokonkhankb12@gmail.com',
    role: 'admin',
    avatarColor: 'from-amber-400 to-rose-500',
  },
  {
    id: 'member_tanvir',
    name: 'Tanvir Ahmed',
    email: 'tanvir@team.com',
    role: 'member',
    avatarColor: 'from-sky-400 to-blue-600',
  },
  {
    id: 'member_rahat',
    name: 'Rahat Hossain',
    email: 'rahat@team.com',
    role: 'member',
    avatarColor: 'from-emerald-400 to-teal-600',
  },
  {
    id: 'member_sumon',
    name: 'Sumon Ali',
    email: 'sumon@team.com',
    role: 'member',
    avatarColor: 'from-violet-400 to-purple-600',
  },
];

// --- Initial Sample Tasks ---
export const DEFAULT_SAMPLE_TASKS: Task[] = [
  {
    id: 'task_sample_1',
    title: 'Review quarterly project deliverables and team milestones',
    priority: 'High',
    status: 'In Progress',
    createdAt: Date.now() - 1000 * 60 * 95,
    updatedAt: Date.now() - 1000 * 60 * 30,
    estimatedMinutes: 60,
    timeSpentSeconds: 45 * 60,
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: 'Rokon Khan (Admin)',
    assigneeEmail: 'rokonkhankb12@gmail.com',
    assigneeId: 'member_rokon',
  },
  {
    id: 'task_sample_2',
    title: 'Draft client presentation deck for afternoon stakeholder sync',
    priority: 'High',
    status: 'To Do',
    createdAt: Date.now() - 1000 * 60 * 60,
    updatedAt: Date.now() - 1000 * 60 * 60,
    estimatedMinutes: 45,
    timeSpentSeconds: 0,
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: 'Tanvir Ahmed',
    assigneeEmail: 'tanvir@team.com',
    assigneeId: 'member_tanvir',
  },
  {
    id: 'task_sample_3',
    title: 'Update daily activity log and verify project documentation',
    priority: 'Medium',
    status: 'Done',
    createdAt: Date.now() - 1000 * 60 * 180,
    updatedAt: Date.now() - 1000 * 60 * 25,
    estimatedMinutes: 30,
    timeSpentSeconds: 75 * 60,
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: 'Rahat Hossain',
    assigneeEmail: 'rahat@team.com',
    assigneeId: 'member_rahat',
  },
  {
    id: 'task_sample_4',
    title: 'Organize design asset folders and export component icons',
    priority: 'Low',
    status: 'To Do',
    createdAt: Date.now() - 1000 * 60 * 20,
    updatedAt: Date.now() - 1000 * 60 * 20,
    estimatedMinutes: 20,
    timeSpentSeconds: 0,
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: 'Sumon Ali',
    assigneeEmail: 'sumon@team.com',
    assigneeId: 'member_sumon',
  },
];

// --- State Variables ---
const STORAGE_KEY = 'daily_work_tracker_tasks_v3';
const TEAM_STORAGE_KEY = 'daily_work_tracker_team_v3';
const CURRENT_USER_KEY = 'daily_work_tracker_current_user_v3';

let tasks: Task[] = [];
let teamMembers: TeamMember[] = [];
let currentUser: TeamMember = GUEST_USER;
let pendingInvitations: TeamInvitation[] = [];
let activeUrlInvitation: TeamInvitation | null = null;

let currentFilterStatus: 'all' | TaskStatus = 'all';
let currentFilterPriority: 'all' | PriorityLevel = 'all';
let currentFilterAssignee: 'all' | 'my-tasks' | string = 'all';
let searchQuery = '';
let currentSortOrder: 'newest' | 'oldest' | 'priority' | 'alphabetical' = 'newest';
let editingTaskId: string | null = null;
let toastTimeout: number | null = null;
let globalTimerInterval: number | null = null;
let isFirestoreConnected = false;

// --- Helper Functions ---
export function isCurrentUserAdmin(): boolean {
  const googleUser = auth.currentUser;
  if (!googleUser || !googleUser.email) {
    return false;
  }
  const emailLower = googleUser.email.toLowerCase();
  if (emailLower === OWNER_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const matched = teamMembers.find((m) => m.email?.toLowerCase() === emailLower);
  return matched?.role === 'admin';
}

function formatMinutesToDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function formatTimerDisplay(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

function formatTotalTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function getTaskCurrentSeconds(task: Task): number {
  let seconds = task.timeSpentSeconds || 0;
  if (task.isTimerRunning && task.timerStartedAt) {
    const elapsed = Math.floor((Date.now() - task.timerStartedAt) / 1000);
    seconds += Math.max(0, elapsed);
  }
  return seconds;
}

function getTotalTrackedSeconds(): number {
  return tasks.reduce((sum, task) => sum + getTaskCurrentSeconds(task), 0);
}

function getTotalPlannedMinutes(): number {
  return tasks.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0);
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Toast & Sync Status UI ---
export function showToast(message: string, isError = false): void {
  const toast = document.getElementById('toast-notification');
  const msgEl = document.getElementById('toast-message');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  if (isError) {
    toast.classList.remove('border-white/15');
    toast.classList.add('border-rose-500/50', 'bg-rose-950/90');
  } else {
    toast.classList.remove('border-rose-500/50', 'bg-rose-950/90');
    toast.classList.add('border-white/15');
  }

  toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
  toast.classList.add('translate-y-0', 'opacity-100');

  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  }, 3500);
}

function updateSyncStatusBadge(connected: boolean): void {
  isFirestoreConnected = connected;
  const badge = document.getElementById('cloud-sync-badge');
  if (!badge) return;

  if (connected) {
    badge.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-400/30 shadow-[0_0_10px_rgba(52,211,153,0.2)] backdrop-blur-sm';
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.9)]"></span>
      <span class="hidden sm:inline">Live Team Sync</span>
      <span class="sm:hidden">Live</span>
    `;
    badge.setAttribute('title', 'Connected to Firebase Firestore: All updates are synced live to all team members.');
  } else {
    badge.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-400/30 backdrop-blur-sm';
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-amber-400"></span>
      <span class="hidden sm:inline">Local / Offline Cache</span>
      <span class="sm:hidden">Local</span>
    `;
    badge.setAttribute('title', 'Operating in local cache mode. Changes are saved in your browser.');
  }
}

// --- Storage Persistence ---
function loadTasksFromStorage(): Task[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveTasksToStorage(DEFAULT_SAMPLE_TASKS);
      return [...DEFAULT_SAMPLE_TASKS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return [...DEFAULT_SAMPLE_TASKS];
  } catch (error) {
    console.error('Failed to parse tasks from localStorage:', error);
    return [...DEFAULT_SAMPLE_TASKS];
  }
}

function saveTasksToStorage(taskList: Task[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(taskList));
  } catch (error) {
    console.error('Failed to save tasks to localStorage:', error);
  }
}

function loadTeamMembers(): TeamMember[] {
  try {
    const raw = localStorage.getItem(TEAM_STORAGE_KEY);
    if (!raw) {
      saveTeamMembers(DEFAULT_TEAM_MEMBERS);
      return [...DEFAULT_TEAM_MEMBERS];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return [...DEFAULT_TEAM_MEMBERS];
  } catch (err) {
    return [...DEFAULT_TEAM_MEMBERS];
  }
}

function saveTeamMembers(members: TeamMember[]): void {
  try {
    localStorage.setItem(TEAM_STORAGE_KEY, JSON.stringify(members));
  } catch (err) {
    console.error('Failed to save team members:', err);
  }
}

function loadCurrentUser(): TeamMember {
  // If user is authenticated with Google:
  if (auth.currentUser?.email) {
    const authEmail = auth.currentUser.email.toLowerCase();
    if (authEmail === OWNER_ADMIN_EMAIL.toLowerCase()) {
      return {
        id: 'member_rokon',
        name: auth.currentUser.displayName || 'Rokon Khan (Admin)',
        email: OWNER_ADMIN_EMAIL,
        role: 'admin',
        avatarColor: 'from-amber-400 to-rose-500',
      };
    }
    const matched = teamMembers.find((m) => m.email.toLowerCase() === authEmail);
    if (matched) return matched;
    return {
      id: `user_${auth.currentUser.uid}`,
      name: auth.currentUser.displayName || authEmail.split('@')[0],
      email: auth.currentUser.email,
      role: 'member',
      avatarColor: 'from-sky-400 to-blue-600',
    };
  }

  // If local unauthenticated visitor:
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name) {
        // Enforce: unauthenticated visitor cannot be admin or impersonate Rokon Khan
        if (parsed.role === 'admin' || parsed.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()) {
          parsed.role = 'member';
          if (parsed.name.includes('(Admin)')) {
            parsed.name = parsed.name.replace('(Admin)', '').trim();
          }
        }
        return parsed;
      }
    }
  } catch (e) {}

  return GUEST_USER;
}

function saveCurrentUser(user: TeamMember): void {
  currentUser = user;
  try {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } catch (e) {}

  // If regular member, default workspace data isolation to my-tasks
  if (!isCurrentUserAdmin()) {
    currentFilterAssignee = 'my-tasks';
  }

  updateCurrentUserHeaderBadge();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  renderTaskList();
}

// --- Real-time Live Watch & Clock ---
let liveClockInterval: any = null;

export function startLiveClockTicker(): void {
  const updateClockAndDate = () => {
    const dateDisplay = document.getElementById('current-date-display');
    const clockDisplay = document.getElementById('current-clock-display');
    const now = new Date();

    if (dateDisplay) {
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      };
      dateDisplay.textContent = now.toLocaleDateString('en-US', options);
    }

    if (clockDisplay) {
      clockDisplay.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      });
    }
  };

  updateClockAndDate();
  if (!liveClockInterval) {
    liveClockInterval = setInterval(updateClockAndDate, 1000);
  }
}

// --- Member Task Metrics (Missed & Completed) ---
export function getMemberMissedTasks(memberName: string, memberEmail?: string): Task[] {
  const todayStr = new Date().toISOString().split('T')[0];
  return tasks.filter((t) => {
    const isAssigned =
      (t.assigneeName && t.assigneeName.trim().toLowerCase() === memberName.trim().toLowerCase()) ||
      (memberEmail && t.assigneeEmail && t.assigneeEmail.toLowerCase() === memberEmail.toLowerCase());
    if (!isAssigned) return false;

    // Check if task is removed/hidden from user's account
    if (t.hiddenForUsers && (t.hiddenForUsers.includes(memberName) || (memberEmail && t.hiddenForUsers.includes(memberEmail)))) {
      return false;
    }

    // Must not be completed
    if (t.status === 'Done') return false;

    // Must have a deadline set and deadline is before today
    if (!t.deadline) return false;
    return t.deadline < todayStr;
  });
}

export function getMemberCompletedTasks(memberName: string, memberEmail?: string): Task[] {
  return tasks.filter((t) => {
    const isAssigned =
      (t.assigneeName && t.assigneeName.trim().toLowerCase() === memberName.trim().toLowerCase()) ||
      (memberEmail && t.assigneeEmail && t.assigneeEmail.toLowerCase() === memberEmail.toLowerCase());
    if (!isAssigned) return false;

    if (t.hiddenForUsers && (t.hiddenForUsers.includes(memberName) || (memberEmail && t.hiddenForUsers.includes(memberEmail)))) {
      return false;
    }

    return t.status === 'Done';
  });
}

// --- Header User Badge ---
export function updateCurrentUserHeaderBadge(): void {
  const nameDisplay = document.getElementById('user-name-display');
  const avatarBadge = document.getElementById('user-avatar-badge');
  const adminPill = document.getElementById('user-admin-pill');
  const missedPill = document.getElementById('user-missed-pill');
  const headerMissedBadge = document.getElementById('header-missed-counter-badge');

  if (nameDisplay) {
    nameDisplay.textContent = currentUser.name;
  }
  if (avatarBadge) {
    const initial = currentUser.name.trim().charAt(0).toUpperCase() || 'U';
    avatarBadge.textContent = initial;
  }
  if (adminPill) {
    if (isCurrentUserAdmin()) {
      adminPill.classList.remove('hidden');
    } else {
      adminPill.classList.add('hidden');
    }
  }

  // Calculate missed/incomplete tasks for current user and display warning badge
  const missedTasks = getMemberMissedTasks(currentUser.name, currentUser.email);
  if (missedPill) {
    if (missedTasks.length > 0) {
      missedPill.textContent = `⚠️ ${missedTasks.length} Missed`;
      missedPill.title = `You have ${missedTasks.length} overdue task${missedTasks.length > 1 ? 's' : ''} past deadline`;
      missedPill.classList.remove('hidden');
    } else {
      missedPill.classList.add('hidden');
    }
  }

  if (headerMissedBadge) {
    if (missedTasks.length > 0) {
      headerMissedBadge.textContent = missedTasks.length.toString();
      headerMissedBadge.classList.remove('hidden');
    } else {
      headerMissedBadge.classList.add('hidden');
    }
  }

  // Update Header Google Auth button text and styling
  const headerAuthBtnText = document.getElementById('header-auth-btn-text');
  const headerAuthBtn = document.getElementById('header-google-auth-btn');
  if (auth.currentUser) {
    if (headerAuthBtnText) {
      const shortName = auth.currentUser.displayName?.split(' ')[0] || auth.currentUser.email?.split('@')[0] || 'User';
      headerAuthBtnText.textContent = `🚪 Sign Out (${shortName})`;
    }
    if (headerAuthBtn) {
      headerAuthBtn.classList.remove('from-sky-500', 'to-indigo-500');
      headerAuthBtn.classList.add('bg-slate-800', 'text-rose-300', 'border-rose-500/30');
    }
  } else {
    if (headerAuthBtnText) {
      headerAuthBtnText.textContent = '🔑 Google Login';
    }
    if (headerAuthBtn) {
      headerAuthBtn.classList.remove('bg-slate-800', 'text-rose-300', 'border-rose-500/30');
      headerAuthBtn.classList.add('from-sky-500', 'to-indigo-500');
    }
  }

  // Update Sidebar Clear Done Tasks button admin indication
  const clearBadge = document.getElementById('clear-completed-admin-badge');
  const clearBtn = document.getElementById('clear-completed-btn');
  if (isCurrentUserAdmin()) {
    if (clearBadge) {
      clearBadge.textContent = 'Admin';
      clearBadge.className = 'px-1.5 py-0.5 rounded bg-emerald-400/20 text-emerald-300 text-[10px] font-bold border border-emerald-400/30';
    }
    if (clearBtn) {
      clearBtn.setAttribute('title', 'Clear all completed tasks from workspace (Admin mode)');
    }
  } else {
    if (clearBadge) {
      clearBadge.textContent = '🔒 Admin Only';
      clearBadge.className = 'px-1.5 py-0.5 rounded bg-amber-400/20 text-amber-300 text-[10px] font-bold border border-amber-400/30';
    }
    if (clearBtn) {
      clearBtn.setAttribute('title', '🔒 শুধুমাত্র অ্যাডমিন (Rokon Khan) সম্পন্ন টাস্ক ক্লিয়ার করতে পারবেন');
    }
  }

  // Update modal profile card
  const modalUserName = document.getElementById('modal-current-user-name');
  const modalUserAvatar = document.getElementById('modal-current-user-avatar');
  const modalUserEmail = document.getElementById('modal-current-user-email');
  const modalUserRole = document.getElementById('modal-current-user-role-badge');
  const googleBtnText = document.getElementById('google-signin-btn-text');
  const googleSignOutBtn = document.getElementById('google-signout-btn');

  if (modalUserName) modalUserName.textContent = currentUser.name;
  if (modalUserAvatar) modalUserAvatar.textContent = currentUser.name.trim().charAt(0).toUpperCase() || 'U';
  if (modalUserEmail) modalUserEmail.textContent = auth.currentUser?.email || currentUser.email || 'Visitor / Member (Not signed in)';

  if (modalUserRole) {
    if (isCurrentUserAdmin()) {
      modalUserRole.textContent = '👑 Verified Admin';
      modalUserRole.className = 'px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-[10px] font-bold border border-amber-400/30';
    } else {
      modalUserRole.textContent = '👤 Member';
      modalUserRole.className = 'px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-[10px] font-medium border border-white/10';
    }
  }

  if (googleBtnText) {
    googleBtnText.textContent = auth.currentUser ? 'Switch Account' : 'Google Login';
  }
  if (googleSignOutBtn) {
    if (auth.currentUser) {
      googleSignOutBtn.classList.remove('hidden');
    } else {
      googleSignOutBtn.classList.add('hidden');
    }
  }

  // Update Personal Monthly Zone & Workspace Tabs
  updateMonthlyZoneUI();
  updateWorkspaceTabsUI();
}

// --- Monthly Work Time & Personal Time Zone Engine ---
export let monthlyZoneSelectedMember: string = 'current_user';

export function getCurrentMonthKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function getCurrentMonthName(d: Date = new Date()): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function canCurrentUserControlTimer(task: Task): { allowed: boolean; reason?: string } {
  if (isCurrentUserAdmin()) {
    return { allowed: true };
  }

  // If task has no assignee set
  if (!task.assigneeName && !task.assigneeEmail) {
    return {
      allowed: false,
      reason: '⚠️ এই টাস্কটি এখনো কাউকে অ্যাসাইন করা হয়নি। শুধুমাত্র অ্যাসাইন করা মেম্বার ও অ্যাডমিন টাইমার চালু বা পজ করতে পারবেন।',
    };
  }

  const curName = (currentUser.name || '').toLowerCase().trim();
  const curEmail = (currentUser.email || auth.currentUser?.email || '').toLowerCase().trim();
  const taskName = (task.assigneeName || '').toLowerCase().trim();
  const taskEmail = (task.assigneeEmail || '').toLowerCase().trim();

  const isAssignee = (taskName && taskName === curName) || (curEmail && taskEmail && taskEmail === curEmail);

  if (isAssignee) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: `🔒 অনুমতি নেই: এই টাস্কের টাইমার শুধুমাত্র "${task.assigneeName || 'অ্যাসাইনি'}" এবং অ্যাডমিন চালু/পজ করতে পারবেন।`,
  };
}

export function getMemberMonthlyTrackedSeconds(
  memberName: string,
  monthKey: string = getCurrentMonthKey(),
  memberEmail?: string
): number {
  let totalSecs = 0;
  const isAll = memberName === 'all';
  const targetMember = teamMembers.find((m) => m.name === memberName);
  const emailLower = (memberEmail || targetMember?.email || '').toLowerCase().trim();
  const nameLower = memberName.toLowerCase().trim();

  tasks.forEach((t) => {
    if (!isAll) {
      const tName = (t.assigneeName || '').toLowerCase().trim();
      const tEmail = (t.assigneeEmail || '').toLowerCase().trim();
      const match = (tName && tName === nameLower) || (emailLower && tEmail && tEmail === emailLower);
      if (!match) return;
    }

    // Accumulate from dailyLogs if recorded
    if (t.dailyLogs && Object.keys(t.dailyLogs).length > 0) {
      Object.entries(t.dailyLogs).forEach(([dateStr, secs]) => {
        if (dateStr.startsWith(monthKey)) {
          totalSecs += secs;
        }
      });
    } else {
      // Fallback for legacy tasks
      const ts = t.completedAt || t.updatedAt || t.createdAt;
      const tMonth = new Date(ts).toISOString().substring(0, 7);
      if (tMonth === monthKey) {
        totalSecs += (t.timeSpentSeconds || 0);
      }
    }

    // Add currently active stopwatch seconds if running in this month
    if (t.isTimerRunning && t.timerStartedAt) {
      const now = Date.now();
      const currentM = new Date(now).toISOString().substring(0, 7);
      if (currentM === monthKey) {
        const elapsed = Math.floor((now - t.timerStartedAt) / 1000);
        totalSecs += Math.max(0, elapsed);
      }
    }
  });

  return totalSecs;
}

export function getDailyWorkSeconds(dateStr: string, memberFilter: string = 'all'): number {
  let total = 0;
  tasks.forEach((t) => {
    if (memberFilter !== 'all' && t.assigneeName !== memberFilter) return;

    if (t.dailyLogs && t.dailyLogs[dateStr]) {
      total += t.dailyLogs[dateStr];
    } else {
      // Fallback: if task was completed on dateStr
      const cDate = t.completedAt ? new Date(t.completedAt).toISOString().split('T')[0] : '';
      if (cDate === dateStr) {
        total += (t.timeSpentSeconds || 0);
      }
    }
  });
  return total;
}

export function updateMonthlyZoneUI(): void {
  const currentMonthKey = getCurrentMonthKey();
  const currentMonthTitle = getCurrentMonthName();

  // Elements
  const monthTitleEl = document.getElementById('monthly-zone-month-title');
  const hoursDisplayEl = document.getElementById('monthly-zone-hours-display');
  const userLabelEl = document.getElementById('monthly-zone-user-label');
  const adminControlsEl = document.getElementById('monthly-zone-admin-controls');
  const memberSelectEl = document.getElementById('monthly-zone-member-select') as HTMLSelectElement | null;
  const headerTimeBadge = document.getElementById('header-monthly-time-badge');

  if (monthTitleEl) {
    monthTitleEl.textContent = currentMonthTitle;
  }

  // Calculate current user's monthly time for header badge
  const currentUserMonthlySecs = getMemberMonthlyTrackedSeconds(currentUser.name, currentMonthKey, currentUser.email);
  if (headerTimeBadge) {
    const hours = Math.floor(currentUserMonthlySecs / 3600);
    const mins = Math.floor((currentUserMonthlySecs % 3600) / 60);
    headerTimeBadge.textContent = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  }

  const isAdmin = isCurrentUserAdmin();

  if (isAdmin && adminControlsEl && memberSelectEl) {
    adminControlsEl.classList.remove('hidden');
    adminControlsEl.classList.add('flex');

    // Populate dropdown options
    const currentVal = memberSelectEl.value || monthlyZoneSelectedMember;
    let selectOptionsHtml = `<option value="current_user">👤 আমার সময় (${escapeHtml(currentUser.name.split(' ')[0])})</option>`;
    selectOptionsHtml += `<option value="all">👥 সকল মেম্বার মোট (All Team Total)</option>`;

    teamMembers.forEach((m) => {
      selectOptionsHtml += `<option value="${escapeHtml(m.name)}">👤 ${escapeHtml(m.name)}</option>`;
    });

    if (memberSelectEl.innerHTML !== selectOptionsHtml) {
      memberSelectEl.innerHTML = selectOptionsHtml;
      memberSelectEl.value = currentVal;
    }

    let targetMemberName = currentUser.name;
    let targetMemberEmail = currentUser.email;

    if (memberSelectEl.value === 'all') {
      targetMemberName = 'all';
    } else if (memberSelectEl.value !== 'current_user') {
      targetMemberName = memberSelectEl.value;
      const found = teamMembers.find((m) => m.name === targetMemberName);
      targetMemberEmail = found?.email;
    }

    const trackedSecs = getMemberMonthlyTrackedSeconds(targetMemberName, currentMonthKey, targetMemberEmail);
    if (hoursDisplayEl) {
      hoursDisplayEl.textContent = formatTotalTime(trackedSecs);
    }
    if (userLabelEl) {
      if (targetMemberName === 'all') {
        userLabelEl.textContent = 'সকল মেম্বারের মোট মাসিক কাজের সময়';
      } else if (targetMemberName === currentUser.name) {
        userLabelEl.textContent = `আমার মাসিক কাজের সময় (${currentUser.name})`;
      } else {
        userLabelEl.textContent = `${targetMemberName}-এর মাসিক কাজের সময়`;
      }
    }
  } else {
    if (adminControlsEl) {
      adminControlsEl.classList.add('hidden');
      adminControlsEl.classList.remove('flex');
    }
    if (hoursDisplayEl) {
      hoursDisplayEl.textContent = formatTotalTime(currentUserMonthlySecs);
    }
    if (userLabelEl) {
      userLabelEl.textContent = `আমার মাসিক কাজের সময় জোন (${currentUser.name})`;
    }
  }
}

export function updateWorkspaceTabsUI(): void {
  const myTasksTab = document.getElementById('view-my-tasks-tab');
  const allTasksTab = document.getElementById('view-all-tasks-tab');
  const tabLabel = document.getElementById('tab-my-tasks-label');
  const noticeEl = document.getElementById('workspace-user-notice');

  if (tabLabel) {
    const firstName = currentUser.name.split(' ')[0] || 'User';
    tabLabel.textContent = `আমার কাজ (${firstName})`;
  }

  if (currentFilterAssignee === 'my-tasks') {
    if (myTasksTab) {
      myTasksTab.className =
        'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-[0_0_10px_rgba(56,189,248,0.2)]';
    }
    if (allTasksTab) {
      allTasksTab.className =
        'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5';
    }
    if (noticeEl) {
      noticeEl.textContent = `ইউজার ইন্টারফেসে শুধুমাত্র আপনার (${currentUser.name}) নিজের ডেটা দৃশ্যমান`;
    }
  } else {
    if (myTasksTab) {
      myTasksTab.className =
        'px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer flex items-center gap-1.5';
    }
    if (allTasksTab) {
      allTasksTab.className =
        'px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 shadow-[0_0_10px_rgba(99,102,241,0.2)]';
    }
    if (noticeEl) {
      noticeEl.textContent = 'টিমের সকল মেম্বারের টাস্ক দৃশ্যমান';
    }
  }
}

// --- Priority & Status Badges ---
function getPriorityBadgeHtml(priority: PriorityLevel): string {
  switch (priority) {
    case 'High':
      return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30 p-high-glow">
          <span class="w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_6px_rgba(244,63,94,0.8)]"></span>
          <span>High</span>
        </span>
      `;
    case 'Medium':
      return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 p-medium-glow">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]"></span>
          <span>Medium</span>
        </span>
      `;
    case 'Low':
    default:
      return `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 p-low-glow">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"></span>
          <span>Low</span>
        </span>
      `;
  }
}

function getStatusBadgeHtml(status: TaskStatus): string {
  switch (status) {
    case 'Done':
      return `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
          </svg>
          <span>Done</span>
        </span>
      `;
    case 'In Progress':
      return `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-500/15 text-sky-300 border border-sky-400/30">
          <span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shadow-[0_0_6px_rgba(56,189,248,0.8)]"></span>
          <span>In Progress</span>
        </span>
      `;
    case 'To Do':
    default:
      return `
        <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-white/5 text-slate-300 border border-white/10">
          <span class="w-1.5 h-1.5 rounded-full border border-slate-400"></span>
          <span>To Do</span>
        </span>
      `;
  }
}

function closeSidebar(): void {
  const sidebar = document.getElementById('app-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  sidebar?.classList.add('-translate-x-full');
  sidebarBackdrop?.classList.add('hidden');
}

function openSidebar(): void {
  const sidebar = document.getElementById('app-sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  sidebar?.classList.remove('-translate-x-full');
  sidebarBackdrop?.classList.remove('hidden');
}

// --- Assignee Options Rendering ---
function renderAssigneeSelectOptions(): void {
  const taskAssigneeSelect = document.getElementById('task-assignee-select') as HTMLSelectElement | null;
  const editTaskAssigneeSelect = document.getElementById('edit-task-assignee-select') as HTMLSelectElement | null;
  const calendarMemberFilter = document.getElementById('calendar-member-filter') as HTMLSelectElement | null;
  const recordsMemberSelect = document.getElementById('records-member-select') as HTMLSelectElement | null;

  const buildOptions = (selectedName?: string) => {
    let html = `
      <option value="">👤 Unassigned (সবার জন্য)</option>
    `;
    teamMembers.forEach((member) => {
      const isSelected = selectedName === member.name ? 'selected' : '';
      const adminTag = member.role === 'admin' ? ' (Admin)' : '';
      html += `<option value="${escapeHtml(member.name)}" ${isSelected}>👤 ${escapeHtml(member.name)}${adminTag}</option>`;
    });
    return html;
  };

  if (taskAssigneeSelect) {
    const currentVal = taskAssigneeSelect.value;
    taskAssigneeSelect.innerHTML = buildOptions(currentVal);
    // If not selected yet, default to current user
    if (!currentVal) {
      taskAssigneeSelect.value = currentUser.name;
    }
  }

  if (editTaskAssigneeSelect) {
    const currentVal = editTaskAssigneeSelect.value;
    editTaskAssigneeSelect.innerHTML = buildOptions(currentVal);
  }

  if (calendarMemberFilter) {
    const currentVal = calendarMemberFilter.value || 'all';
    let cHtml = `<option value="all" ${currentVal === 'all' ? 'selected' : ''}>👥 সকল মেম্বার (All Members)</option>`;
    teamMembers.forEach((member) => {
      cHtml += `<option value="${escapeHtml(member.name)}" ${currentVal === member.name ? 'selected' : ''}>👤 ${escapeHtml(member.name)}</option>`;
    });
    calendarMemberFilter.innerHTML = cHtml;
  }

  if (recordsMemberSelect) {
    const currentVal = recordsMemberSelect.value || currentUser.name;
    let rHtml = '';
    teamMembers.forEach((member) => {
      const missed = getMemberMissedTasks(member.name, member.email).length;
      const missedBadge = missed > 0 ? ` (⚠️ ${missed} Missed)` : '';
      rHtml += `<option value="${escapeHtml(member.name)}" ${currentVal === member.name ? 'selected' : ''}>👤 ${escapeHtml(member.name)}${missedBadge}</option>`;
    });
    recordsMemberSelect.innerHTML = rHtml;
  }
}

// --- Sidebar Assignee Filters Rendering ---
function renderSidebarAssigneeFilters(): void {
  const container = document.getElementById('assignee-filters-container');
  if (!container) return;

  const allCount = tasks.length;
  const myCount = tasks.filter((t) => t.assigneeName === currentUser.name).length;

  let html = `
    <!-- All Assignees -->
    <button 
      type="button" 
      data-filter-assignee="all" 
      class="filter-assignee-btn w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-lg ${
        currentFilterAssignee === 'all'
          ? 'bg-sky-500/15 text-sky-400 border border-sky-400/30 font-bold shadow-[0_0_10px_rgba(56,189,248,0.15)]'
          : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
      } transition-all cursor-pointer"
    >
      <div class="flex items-center gap-2">
        <svg class="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
        <span>All Team Tasks</span>
      </div>
      <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-white/5 text-slate-300">${allCount}</span>
    </button>

    <!-- My Tasks Button -->
    <button 
      type="button" 
      data-filter-assignee="my-tasks" 
      class="filter-assignee-btn w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-lg ${
        currentFilterAssignee === 'my-tasks'
          ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/30 font-bold shadow-[0_0_10px_rgba(99,102,241,0.2)]'
          : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
      } transition-all cursor-pointer"
    >
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
        <span>My Tasks (${escapeHtml(currentUser.name.split(' ')[0])})</span>
      </div>
      <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-300">${myCount}</span>
    </button>
  `;

  teamMembers.forEach((member) => {
    const count = tasks.filter((t) => t.assigneeName === member.name).length;
    const isSelected = currentFilterAssignee === member.name;
    html += `
      <button 
        type="button" 
        data-filter-assignee="${escapeHtml(member.name)}" 
        class="filter-assignee-btn w-full flex items-center justify-between px-3 py-1.5 text-xs font-medium rounded-lg ${
          isSelected
            ? 'bg-white/10 text-white border border-white/20 font-bold'
            : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
        } transition-all cursor-pointer"
      >
        <div class="flex items-center gap-2 truncate pr-2">
          <span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
          <span class="truncate">${escapeHtml(member.name)}</span>
        </div>
        <span class="text-xs text-slate-400 font-semibold">${count}</span>
      </button>
    `;
  });

  container.innerHTML = html;

  // Bind click events
  container.querySelectorAll('.filter-assignee-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const filter = btn.getAttribute('data-filter-assignee') || 'all';
      currentFilterAssignee = filter;
      renderSidebarAssigneeFilters();
      renderTaskList();
      if (window.innerWidth < 1024) closeSidebar();
    });
  });
}

// --- Daily Overview Summary Calculations ---
export function updateDailyOverview(): void {
  const total = tasks.length;
  const todo = tasks.filter((t) => t.status === 'To Do').length;
  const inProgress = tasks.filter((t) => t.status === 'In Progress').length;
  const done = tasks.filter((t) => t.status === 'Done').length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  const totalEl = document.getElementById('stat-total');
  const todoEl = document.getElementById('stat-todo');
  const inProgressEl = document.getElementById('stat-inprogress');
  const doneEl = document.getElementById('stat-done');
  const percentEl = document.getElementById('overview-progress-percent');
  const progressBar = document.getElementById('overview-progress-bar');
  const plannedTimeEl = document.getElementById('overview-planned-time');
  const totalTimeEl = document.getElementById('overview-total-time');

  if (totalEl) totalEl.textContent = total.toString();
  if (todoEl) todoEl.textContent = todo.toString();
  if (inProgressEl) inProgressEl.textContent = inProgress.toString();
  if (doneEl) doneEl.textContent = done.toString();
  if (percentEl) percentEl.textContent = `${percentage}%`;
  if (progressBar) progressBar.style.width = `${percentage}%`;

  if (plannedTimeEl) {
    plannedTimeEl.textContent = formatMinutesToDuration(getTotalPlannedMinutes());
  }
  if (totalTimeEl) {
    totalTimeEl.textContent = formatTotalTime(getTotalTrackedSeconds());
  }

  // Update Status Badges
  const badgeAll = document.getElementById('badge-count-all');
  const badgeTodo = document.getElementById('badge-count-todo');
  const badgeInProgress = document.getElementById('badge-count-inprogress');
  const badgeDone = document.getElementById('badge-count-done');

  if (badgeAll) badgeAll.textContent = total.toString();
  if (badgeTodo) badgeTodo.textContent = todo.toString();
  if (badgeInProgress) badgeInProgress.textContent = inProgress.toString();
  if (badgeDone) badgeDone.textContent = done.toString();

  // Update Priority Badges
  const highCount = tasks.filter((t) => t.priority === 'High').length;
  const medCount = tasks.filter((t) => t.priority === 'Medium').length;
  const lowCount = tasks.filter((t) => t.priority === 'Low').length;

  const priAll = document.getElementById('badge-priority-all');
  const priHigh = document.getElementById('badge-priority-high');
  const priMed = document.getElementById('badge-priority-medium');
  const priLow = document.getElementById('badge-priority-low');

  if (priAll) priAll.textContent = total.toString();
  if (priHigh) priHigh.textContent = highCount.toString();
  if (priMed) priMed.textContent = medCount.toString();
  if (priLow) priLow.textContent = lowCount.toString();

  renderSidebarAssigneeFilters();
}

// --- Ticker for active Stopwatches ---
function startGlobalTimerTicker(): void {
  if (globalTimerInterval) {
    window.clearInterval(globalTimerInterval);
  }
  globalTimerInterval = window.setInterval(() => {
    const runningTasks = tasks.filter((t) => t.isTimerRunning && t.timerStartedAt);
    if (runningTasks.length === 0) return;

    runningTasks.forEach((task) => {
      const liveSecs = getTaskCurrentSeconds(task);
      const els = document.querySelectorAll(`[data-timer-id="${task.id}"]`);
      els.forEach((el) => {
        el.textContent = formatTimerDisplay(liveSecs);
      });
    });

    const totalTimeEl = document.getElementById('overview-total-time');
    if (totalTimeEl) {
      totalTimeEl.textContent = formatTotalTime(getTotalTrackedSeconds());
    }

    // Live update monthly zone display and header indicator
    updateMonthlyZoneUI();
  }, 1000);
}

// --- Filtering & Sorting ---
function getFilteredAndSortedTasks(): Task[] {
  let result = [...tasks];

  // Status Filter
  if (currentFilterStatus !== 'all') {
    result = result.filter((t) => t.status === currentFilterStatus);
  }

  // Priority Filter
  if (currentFilterPriority !== 'all') {
    result = result.filter((t) => t.priority === currentFilterPriority);
  }

  // Assignee Filter
  if (currentFilterAssignee === 'my-tasks') {
    result = result.filter((t) => {
      if (t.assigneeName !== currentUser.name) return false;
      // If user removed this task from their account view, respect it
      if (
        t.hiddenForUsers &&
        (t.hiddenForUsers.includes(currentUser.name) ||
          (currentUser.email && t.hiddenForUsers.includes(currentUser.email)))
      ) {
        return false;
      }
      return true;
    });
  } else if (currentFilterAssignee !== 'all') {
    result = result.filter((t) => t.assigneeName === currentFilterAssignee);
  }

  // Text Search Query
  if (searchQuery.trim().length > 0) {
    const q = searchQuery.toLowerCase().trim();
    result = result.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q) ||
        (t.assigneeName && t.assigneeName.toLowerCase().includes(q))
    );
  }

  // Sorting
  const priorityWeight: Record<PriorityLevel, number> = { High: 3, Medium: 2, Low: 1 };
  result.sort((a, b) => {
    switch (currentSortOrder) {
      case 'newest':
        return b.createdAt - a.createdAt;
      case 'oldest':
        return a.createdAt - b.createdAt;
      case 'priority':
        return priorityWeight[b.priority] - priorityWeight[a.priority];
      case 'alphabetical':
        return a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  return result;
}

// --- Render Task List ---
export function renderTaskList(): void {
  const container = document.getElementById('task-list-container');
  const counterEl = document.getElementById('task-list-counter');
  const activeFilterInd = document.getElementById('active-filter-indicator');
  const resetFilterQuickBtn = document.getElementById('reset-filter-quick-btn');

  if (!container) return;

  const filteredTasks = getFilteredAndSortedTasks();

  if (counterEl) {
    counterEl.textContent = `Showing ${filteredTasks.length} of ${tasks.length} total tasks`;
  }

  if (activeFilterInd) {
    const filters: string[] = [];
    if (currentFilterStatus !== 'all') filters.push(`Status: ${currentFilterStatus}`);
    if (currentFilterPriority !== 'all') filters.push(`Priority: ${currentFilterPriority}`);
    if (currentFilterAssignee !== 'all') {
      filters.push(currentFilterAssignee === 'my-tasks' ? 'Assigned: Mine' : `Assignee: ${currentFilterAssignee}`);
    }
    if (searchQuery.trim().length > 0) filters.push(`"${searchQuery}"`);

    if (filters.length > 0) {
      activeFilterInd.textContent = `${filters.join(' · ')} (${filteredTasks.length})`;
      resetFilterQuickBtn?.classList.remove('hidden');
    } else {
      activeFilterInd.textContent = `All (${filteredTasks.length})`;
      resetFilterQuickBtn?.classList.add('hidden');
    }
  }

  if (filteredTasks.length === 0) {
    let emptyTitle = 'No tasks found';
    let emptySubtitle = 'Add a new task using the form above to begin tracking and collaborating with your team.';
    if (tasks.length > 0) {
      emptyTitle = 'No matching tasks';
      emptySubtitle = 'No tasks match your selected filter or search query. Try resetting filters.';
    }

    container.innerHTML = `
      <div class="py-14 px-4 text-center">
        <div class="w-14 h-14 mx-auto mb-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 shadow-inner">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        </div>
        <h3 class="text-sm font-bold text-white">${emptyTitle}</h3>
        <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">${emptySubtitle}</p>
        ${
          tasks.length > 0
            ? `
            <button 
              type="button" 
              onclick="window.resetAllFilters()" 
              class="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-sky-300 bg-sky-500/15 border border-sky-400/30 hover:bg-sky-500/25 rounded-xl transition-all shadow-[0_0_10px_rgba(56,189,248,0.15)] cursor-pointer"
            >
              Reset Filters
            </button>
          `
            : ''
        }
      </div>
    `;
    return;
  }

  const isAdmin = isCurrentUserAdmin();

  const itemsHtml = filteredTasks
    .map((task) => {
      const isDone = task.status === 'Done';
      const isInProgress = task.status === 'In Progress';
      const isTodo = task.status === 'To Do';

      const currentSecs = getTaskCurrentSeconds(task);
      const isTimerRunning = !!task.isTimerRunning;
      const timerDisplayStr = formatTimerDisplay(currentSecs);

      const isAssignedToCurrent = task.assigneeName && task.assigneeName === currentUser.name;

      // Assignee Badge
      let assigneeBadgeHtml = '';
      if (task.assigneeName) {
        assigneeBadgeHtml = `
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isAssignedToCurrent
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/35 shadow-[0_0_8px_rgba(99,102,241,0.25)]'
              : 'bg-white/5 text-slate-300 border border-white/10'
          }" title="Assigned to: ${escapeHtml(task.assigneeName)}">
            <svg class="w-3 h-3 ${isAssignedToCurrent ? 'text-indigo-400' : 'text-slate-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <span>${escapeHtml(task.assigneeName)}${isAssignedToCurrent ? ' (You)' : ''}</span>
          </span>
        `;
      } else {
        assigneeBadgeHtml = `
          <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.02] text-slate-400 border border-white/5" title="No team member assigned yet">
            <span>Unassigned</span>
          </span>
        `;
      }

      // Allocated Target Time Badge
      let estBadgeHtml = '';
      if (task.estimatedMinutes && task.estimatedMinutes > 0) {
        const isOverTime = currentSecs > task.estimatedMinutes * 60;
        estBadgeHtml = `
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isOverTime
              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 shadow-[0_0_8px_rgba(245,158,11,0.2)]'
              : 'bg-violet-500/10 text-violet-300 border border-violet-500/25'
          }" title="${
            isOverTime
              ? 'Allocated: ' + formatMinutesToDuration(task.estimatedMinutes) + ' (Exceeded target)'
              : 'Allocated target time: ' + formatMinutesToDuration(task.estimatedMinutes)
          }">
            <svg class="w-3 h-3 ${isOverTime ? 'text-amber-400' : 'text-violet-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke-width="2"/>
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6l4 2"/>
            </svg>
            <span>Est: ${formatMinutesToDuration(task.estimatedMinutes)}</span>
            ${isOverTime ? '<span class="text-[10px] text-amber-400 font-bold ml-0.5">(+over)</span>' : ''}
          </span>
        `;
      }

      // Stopwatch Timer Button (অ্যাসাইন করা মেম্বার ও অ্যাডমিন নিয়ন্ত্রণ করতে পারবেন)
      const timerPerm = canCurrentUserControlTimer(task);
      let timerBtnHtml = '';
      if (isTimerRunning) {
        timerBtnHtml = `
          <button
            type="button"
            data-action="toggle-timer"
            data-id="${task.id}"
            class="task-timer-btn inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.3)] transition-all cursor-pointer"
            title="${timerPerm.allowed ? 'Pause timer (currently tracking)' : escapeHtml(timerPerm.reason || '')}"
          >
            <span class="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shadow-[0_0_6px_rgba(56,189,248,0.9)]"></span>
            <svg class="w-3 h-3 text-sky-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
            <span class="font-mono tracking-tight" data-timer-id="${task.id}">${timerDisplayStr}</span>
          </button>
        `;
      } else {
        timerBtnHtml = `
          <button
            type="button"
            data-action="toggle-timer"
            data-id="${task.id}"
            class="task-timer-btn inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg ${
              !timerPerm.allowed
                ? 'bg-white/5 text-slate-400 opacity-60 border border-white/5 hover:border-amber-400/30 hover:opacity-85'
                : currentSecs > 0
                  ? 'bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white border border-white/15 shadow-inner'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/10'
            } transition-all cursor-pointer"
            title="${timerPerm.allowed ? 'Start timer for this task' : escapeHtml(timerPerm.reason || '')}"
          >
            ${
              !timerPerm.allowed
                ? `<svg class="w-3 h-3 text-amber-400/80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>`
                : `<svg class="w-3 h-3 text-slate-400" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>`
            }
            <span class="font-mono tracking-tight" data-timer-id="${task.id}">${timerDisplayStr}</span>
          </button>
        `;
      }

      // Quick Action Button
      let quickActionBtn = '';
      if (isTodo) {
        quickActionBtn = `
          <button
            type="button"
            data-action="start"
            data-id="${task.id}"
            class="task-quick-action-btn inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 border border-sky-400/30 shadow-[0_0_8px_rgba(56,189,248,0.2)] transition-all cursor-pointer"
            title="Move task to In Progress"
          >
            <svg class="w-3 h-3 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Start</span>
          </button>
        `;
      } else if (isInProgress) {
        quickActionBtn = `
          <button
            type="button"
            data-action="done"
            data-id="${task.id}"
            class="task-quick-action-btn inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-400/30 shadow-[0_0_8px_rgba(16,185,129,0.2)] transition-all cursor-pointer"
            title="Mark task as Done"
          >
            <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
            </svg>
            <span>Mark Done</span>
          </button>
        `;
      } else {
        quickActionBtn = `
          <button
            type="button"
            data-action="reopen"
            data-id="${task.id}"
            class="task-quick-action-btn inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10 transition-all cursor-pointer"
            title="Reopen task (move back to To Do)"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Reopen</span>
          </button>
        `;
      }

      // Delete Button: ONLY ADMIN CAN DELETE!
      let deleteBtnHtml = '';
      if (isAdmin) {
        deleteBtnHtml = `
          <button
            type="button"
            data-action="delete"
            data-id="${task.id}"
            class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/15 border border-white/10 hover:border-rose-500/30 transition-colors cursor-pointer"
            title="Delete task (Admin action)"
            aria-label="Delete task"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        `;
      } else {
        deleteBtnHtml = `
          <button
            type="button"
            data-action="restricted-delete"
            data-id="${task.id}"
            class="p-1.5 rounded-lg text-slate-500 hover:text-amber-400 hover:bg-amber-500/10 border border-white/5 transition-colors cursor-pointer"
            title="🔒 Delete restricted: Only Workspace Admin (${ADMIN_EMAIL}) can delete tasks"
            aria-label="Delete restricted"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </button>
        `;
      }

      // Start Date and Deadline Badges
      let dateBadgesHtml = '';
      if (task.startDate) {
        dateBadgesHtml += `
          <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-300 border border-sky-500/20" title="Start date: ${escapeHtml(task.startDate)}">
            <svg class="w-3 h-3 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <span>Start: ${escapeHtml(task.startDate)}</span>
          </span>
        `;
      }

      const todayIso = new Date().toISOString().split('T')[0];
      const isOverdue = !isDone && !!task.deadline && task.deadline < todayIso;

      if (task.deadline) {
        if (isDone) {
          dateBadgesHtml += `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" title="Completed (Deadline was: ${escapeHtml(task.deadline)})">
              <svg class="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span>Due: ${escapeHtml(task.deadline)}</span>
            </span>
          `;
        } else if (isOverdue) {
          dateBadgesHtml += `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 animate-pulse shadow-[0_0_8px_rgba(244,63,94,0.3)]" title="Overdue! Missed deadline was ${escapeHtml(task.deadline)}">
              <svg class="w-3 h-3 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke-width="2"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l2 2" />
              </svg>
              <span>⚠️ Overdue (${escapeHtml(task.deadline)})</span>
            </span>
          `;
        } else {
          dateBadgesHtml += `
            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/25" title="Deadline: ${escapeHtml(task.deadline)}">
              <svg class="w-3 h-3 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke-width="2"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6l4 2"/>
              </svg>
              <span>Due: ${escapeHtml(task.deadline)}</span>
            </span>
          `;
        }
      }

      return `
        <div 
          id="task-row-${task.id}" 
          class="p-4 hover:bg-white/[0.03] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 group border-b border-white/5 last:border-0"
        >
          <!-- Left side: Checkbox toggle & Task Details -->
          <div class="flex items-start sm:items-center gap-3 min-w-0 flex-1">
            
            <!-- Quick Status Toggle Circle -->
            <button
              type="button"
              data-action="toggle-status"
              data-id="${task.id}"
              class="mt-0.5 sm:mt-0 w-5 h-5 rounded-full border ${
                isDone
                  ? 'bg-emerald-500 border-emerald-400 text-slate-950 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                  : 'border-white/20 hover:border-sky-400 bg-white/5'
              } shrink-0 focus:outline-none focus:ring-2 focus:ring-sky-400 transition-all cursor-pointer"
              title="${isDone ? 'Mark as incomplete' : 'Mark as completed'}"
            >
              ${
                isDone
                  ? `<svg class="w-3 h-3 stroke-[3]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>`
                  : ''
              }
            </button>

            <!-- Task Title and Metadata Badges -->
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-baseline flex-wrap gap-x-2">
                <span class="text-sm font-medium ${
                  isDone ? 'text-slate-500 line-through' : 'text-slate-100'
                } break-words">
                  ${escapeHtml(task.title)}
                </span>
              </div>

              <!-- Badges and meta row -->
              <div class="flex items-center flex-wrap gap-2 pt-0.5">
                ${getPriorityBadgeHtml(task.priority)}
                ${getStatusBadgeHtml(task.status)}
                ${assigneeBadgeHtml}
                ${dateBadgesHtml}
                ${estBadgeHtml}

                <!-- Tracked Time Pill -->
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                  isTimerRunning
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-400/30 shadow-[0_0_10px_rgba(56,189,248,0.2)]'
                    : currentSecs > 0
                      ? 'bg-white/5 text-slate-300 border border-white/10'
                      : 'bg-white/[0.03] text-slate-400 border border-white/5'
                }">
                  <svg class="w-3 h-3 ${isTimerRunning ? 'text-sky-400 animate-spin' : 'text-slate-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span class="font-mono" data-timer-id="${task.id}">${timerDisplayStr}</span>
                </span>

                <span class="text-xs text-slate-400">
                  Added ${formatRelativeTime(task.createdAt)}
                </span>
              </div>
            </div>

          </div>

          <!-- Right side: Timer button, status dropdown, quick actions, edit, delete -->
          <div class="flex items-center gap-1.5 self-end sm:self-center shrink-0 flex-wrap">
            ${timerBtnHtml}

            <!-- Status Dropdown Selector -->
            <div class="relative">
              <select
                data-action="change-status-dropdown"
                data-id="${task.id}"
                class="status-dropdown-select text-xs font-semibold py-1.5 pl-2.5 pr-6 rounded-xl border border-white/10 bg-slate-900 text-slate-200 hover:border-white/20 focus:outline-none focus:border-sky-400/60 focus:ring-2 focus:ring-sky-400/20 cursor-pointer transition-all"
                title="Change task status directly"
              >
                <option value="To Do" ${task.status === 'To Do' ? 'selected' : ''}>To Do</option>
                <option value="In Progress" ${task.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                <option value="Done" ${task.status === 'Done' ? 'selected' : ''}>Done</option>
              </select>
            </div>

            ${quickActionBtn}

            <!-- Edit Button -->
            <button
              type="button"
              data-action="edit"
              data-id="${task.id}"
              class="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 border border-white/10 transition-colors cursor-pointer"
              title="Edit task details & assignee"
              aria-label="Edit task"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>

            <!-- Delete Button (Guarded for Admin) -->
            ${deleteBtnHtml}

          </div>
        </div>
      `;
    })
    .join('');

  container.innerHTML = itemsHtml;
}

// --- Task CRUD Operations & Firestore Sync ---
export async function handleAddTask(e?: Event): Promise<void> {
  if (e) e.preventDefault();

  const titleInput = document.getElementById('task-title-input') as HTMLInputElement | null;
  const prioritySelect = document.getElementById('task-priority-select') as HTMLSelectElement | null;
  const statusSelect = document.getElementById('task-status-select') as HTMLSelectElement | null;
  const estimatedInput = document.getElementById('task-estimated-input') as HTMLInputElement | null;
  const assigneeSelect = document.getElementById('task-assignee-select') as HTMLSelectElement | null;

  if (!titleInput) return;
  const title = titleInput.value.trim();
  if (!title) {
    showToast('Please enter a task description');
    titleInput.focus();
    return;
  }

  const priority = (prioritySelect?.value || 'Medium') as PriorityLevel;
  const status = (statusSelect?.value || 'To Do') as TaskStatus;

  const assigneeName = assigneeSelect?.value || '';
  const assignedMember = teamMembers.find((m) => m.name === assigneeName);

  const startDateInput = document.getElementById('task-start-date-input') as HTMLInputElement | null;
  const deadlineInput = document.getElementById('task-deadline-input') as HTMLInputElement | null;

  const startDate = startDateInput?.value || new Date().toISOString().split('T')[0];
  const deadline = deadlineInput?.value || undefined;

  const newTask: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title,
    priority,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    startDate,
    deadline,
    completedAt: status === 'Done' ? Date.now() : undefined,
    estimatedMinutes: 0,
    timeSpentSeconds: 0,
    dailyLogs: {},
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: assigneeName || undefined,
    assigneeEmail: assignedMember?.email,
    assigneeId: assignedMember?.id,
    createdBy: currentUser.name,
    hiddenForUsers: [],
  };

  // Optimistic UI update
  tasks.unshift(newTask);
  saveTasksToStorage(tasks);

  titleInput.value = '';
  if (deadlineInput) deadlineInput.value = '';
  titleInput.focus();

  updateDailyOverview();
  renderTaskList();
  updateCurrentUserHeaderBadge();
  showToast(
    assigneeName
      ? `Task added and assigned to ${assigneeName}`
      : 'Task added successfully'
  );

  // Sync to Firestore
  try {
    await setDoc(doc(db, 'tasks', newTask.id), newTask);
    updateSyncStatusBadge(true);
  } catch (err) {
    console.warn('Firestore write error (using local storage):', err);
  }
}

export async function handleUpdateTaskStatus(taskId: string, newStatus: TaskStatus): Promise<void> {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  if (!task.dailyLogs) task.dailyLogs = {};

  if (newStatus === 'Done' && task.isTimerRunning) {
    if (task.timerStartedAt) {
      const elapsed = Math.max(0, Math.floor((now - task.timerStartedAt) / 1000));
      task.timeSpentSeconds = Math.max(0, (task.timeSpentSeconds || 0) + elapsed);
      task.dailyLogs[todayStr] = (task.dailyLogs[todayStr] || 0) + elapsed;
    }
    task.isTimerRunning = false;
    task.timerStartedAt = null;
  }

  task.status = newStatus;
  task.updatedAt = now;
  if (newStatus === 'Done') {
    if (!task.completedAt) task.completedAt = now;
  } else {
    task.completedAt = undefined;
  }

  saveTasksToStorage(tasks);

  updateDailyOverview();
  renderTaskList();
  updateCurrentUserHeaderBadge();
  updateMonthlyZoneUI();
  showToast(`Status updated to "${newStatus}"`);

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      status: task.status,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt || null,
      timeSpentSeconds: task.timeSpentSeconds,
      dailyLogs: task.dailyLogs,
      isTimerRunning: task.isTimerRunning,
      timerStartedAt: task.timerStartedAt,
    });
  } catch (err) {
    console.warn('Firestore update error:', err);
  }
}

export async function handleToggleTaskTimer(taskId: string): Promise<void> {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  // Strict permission check: only assigned member and admin can start/pause timer
  const perm = canCurrentUserControlTimer(task);
  if (!perm.allowed) {
    showToast(perm.reason || 'টাইমার নিয়ন্ত্রণ করার অনুমতি নেই।', true);
    return;
  }

  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  if (!task.dailyLogs) task.dailyLogs = {};

  if (task.isTimerRunning) {
    if (task.timerStartedAt) {
      const elapsed = Math.max(0, Math.floor((now - task.timerStartedAt) / 1000));
      task.timeSpentSeconds = Math.max(0, (task.timeSpentSeconds || 0) + elapsed);
      task.dailyLogs[todayStr] = (task.dailyLogs[todayStr] || 0) + elapsed;
    }
    task.isTimerRunning = false;
    task.timerStartedAt = null;
    showToast(`Timer paused for "${task.title.length > 20 ? task.title.substring(0, 20) + '...' : task.title}"`);
  } else {
    task.isTimerRunning = true;
    task.timerStartedAt = now;
    if (task.status === 'To Do') {
      task.status = 'In Progress';
    }
    showToast(`Timer started for "${task.title.length > 20 ? task.title.substring(0, 20) + '...' : task.title}"`);
  }

  task.updatedAt = now;
  saveTasksToStorage(tasks);
  updateDailyOverview();
  updateMonthlyZoneUI();
  renderTaskList();

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      isTimerRunning: task.isTimerRunning,
      timerStartedAt: task.timerStartedAt,
      timeSpentSeconds: task.timeSpentSeconds,
      dailyLogs: task.dailyLogs,
      status: task.status,
      updatedAt: task.updatedAt,
    });
  } catch (err) {
    console.warn('Firestore timer update error:', err);
  }
}

export function showAdminRestrictedNotice(): void {
  const modal = document.getElementById('admin-restricted-modal');
  if (modal) {
    modal.classList.remove('hidden');
  } else {
    showToast(`⚠️ শুধুমাত্র অ্যাডমিন (${ADMIN_EMAIL}) টাস্ক ডিলিট করতে পারবেন।`, true);
  }
}

export async function handleDeleteTask(taskId: string): Promise<void> {
  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    return;
  }

  const task = tasks.find((t) => t.id === taskId);
  const taskTitle = task ? task.title : 'Task';

  tasks = tasks.filter((t) => t.id !== taskId);
  saveTasksToStorage(tasks);

  updateDailyOverview();
  renderTaskList();
  showToast(`Deleted by Admin: "${taskTitle.length > 20 ? taskTitle.substring(0, 20) + '...' : taskTitle}"`);

  // Sync to Firestore
  try {
    await deleteDoc(doc(db, 'tasks', taskId));
  } catch (err) {
    console.warn('Firestore delete error:', err);
  }
}

export async function handleClearCompleted(): Promise<void> {
  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    return;
  }

  const completed = tasks.filter((t) => t.status === 'Done');
  if (completed.length === 0) {
    showToast('No completed tasks to clear');
    return;
  }

  if (window.confirm(`Are you sure you want to permanently delete all ${completed.length} completed task(s)?`)) {
    tasks = tasks.filter((t) => t.status !== 'Done');
    saveTasksToStorage(tasks);
    updateDailyOverview();
    renderTaskList();
    showToast(`Admin deleted ${completed.length} completed task(s)`);

    // Delete in Firestore
    for (const t of completed) {
      deleteDoc(doc(db, 'tasks', t.id)).catch(console.error);
    }
  }
}

// --- Edit Modal Operations ---
export function openEditModal(taskId: string): void {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  editingTaskId = taskId;
  const modal = document.getElementById('edit-modal');
  const idInput = document.getElementById('edit-task-id') as HTMLInputElement | null;
  const titleInput = document.getElementById('edit-task-title') as HTMLTextAreaElement | null;
  const prioritySelect = document.getElementById('edit-task-priority') as HTMLSelectElement | null;
  const statusSelect = document.getElementById('edit-task-status') as HTMLSelectElement | null;
  const estimatedInput = document.getElementById('edit-task-estimated-minutes') as HTMLInputElement | null;
  const timeInput = document.getElementById('edit-task-time-minutes') as HTMLInputElement | null;
  const assigneeSelect = document.getElementById('edit-task-assignee-select') as HTMLSelectElement | null;
  const startDateInput = document.getElementById('edit-task-start-date') as HTMLInputElement | null;
  const deadlineInput = document.getElementById('edit-task-deadline-date') as HTMLInputElement | null;

  if (idInput) idInput.value = task.id;
  if (titleInput) titleInput.value = task.title;
  if (prioritySelect) prioritySelect.value = task.priority;
  if (statusSelect) statusSelect.value = task.status;

  if (startDateInput) {
    startDateInput.value = task.startDate || new Date(task.createdAt).toISOString().split('T')[0];
  }
  if (deadlineInput) {
    deadlineInput.value = task.deadline || '';
  }

  if (estimatedInput) {
    estimatedInput.value = task.estimatedMinutes && task.estimatedMinutes > 0 ? task.estimatedMinutes.toString() : '';
  }
  if (timeInput) {
    const currentMins = Math.round(getTaskCurrentSeconds(task) / 60);
    timeInput.value = currentMins.toString();
  }

  if (assigneeSelect) {
    renderAssigneeSelectOptions();
    assigneeSelect.value = task.assigneeName || '';
  }

  if (modal) {
    modal.classList.remove('hidden');
    titleInput?.focus();
  }
}

export function closeEditModal(): void {
  const modal = document.getElementById('edit-modal');
  if (modal) modal.classList.add('hidden');
  editingTaskId = null;
}

export async function handleSaveEdit(e?: Event): Promise<void> {
  if (e) e.preventDefault();
  if (!editingTaskId) return;

  const task = tasks.find((t) => t.id === editingTaskId);
  if (!task) return;

  const titleInput = document.getElementById('edit-task-title') as HTMLTextAreaElement | null;
  const prioritySelect = document.getElementById('edit-task-priority') as HTMLSelectElement | null;
  const statusSelect = document.getElementById('edit-task-status') as HTMLSelectElement | null;
  const estimatedInput = document.getElementById('edit-task-estimated-minutes') as HTMLInputElement | null;
  const timeInput = document.getElementById('edit-task-time-minutes') as HTMLInputElement | null;
  const assigneeSelect = document.getElementById('edit-task-assignee-select') as HTMLSelectElement | null;
  const startDateInput = document.getElementById('edit-task-start-date') as HTMLInputElement | null;
  const deadlineInput = document.getElementById('edit-task-deadline-date') as HTMLInputElement | null;

  const updatedTitle = titleInput?.value.trim();
  if (!updatedTitle) {
    showToast('Task description cannot be empty');
    return;
  }

  task.title = updatedTitle;
  task.priority = (prioritySelect?.value || 'Medium') as PriorityLevel;
  task.status = (statusSelect?.value || 'To Do') as TaskStatus;

  task.startDate = startDateInput?.value || undefined;
  task.deadline = deadlineInput?.value || undefined;

  if (task.status === 'Done') {
    if (!task.completedAt) task.completedAt = Date.now();
  } else {
    task.completedAt = undefined;
  }

  if (estimatedInput) {
    const parsedEst = Math.max(0, parseInt(estimatedInput.value, 10) || 0);
    task.estimatedMinutes = parsedEst > 0 ? parsedEst : 0;
  }

  if (timeInput && timeInput.value.trim() !== '') {
    const parsedMins = Math.max(0, parseInt(timeInput.value, 10) || 0);
    task.timeSpentSeconds = parsedMins * 60;
    if (task.isTimerRunning) {
      task.timerStartedAt = Date.now();
    }
  }

  if (assigneeSelect) {
    const selectedName = assigneeSelect.value;
    task.assigneeName = selectedName || undefined;
    const member = teamMembers.find((m) => m.name === selectedName);
    task.assigneeEmail = member?.email;
    task.assigneeId = member?.id;
  }

  task.updatedAt = Date.now();

  saveTasksToStorage(tasks);
  updateDailyOverview();
  renderTaskList();
  updateCurrentUserHeaderBadge();
  closeEditModal();
  showToast('Task updated successfully');

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', task.id), {
      title: task.title,
      priority: task.priority,
      status: task.status,
      startDate: task.startDate || null,
      deadline: task.deadline || null,
      completedAt: task.completedAt || null,
      estimatedMinutes: task.estimatedMinutes || 0,
      timeSpentSeconds: task.timeSpentSeconds,
      assigneeName: task.assigneeName || null,
      assigneeEmail: task.assigneeEmail || null,
      assigneeId: task.assigneeId || null,
      updatedAt: task.updatedAt,
    });
  } catch (err) {
    console.warn('Firestore update error:', err);
  }
}

// --- Team Sharing Modal ---
export function openShareModal(): void {
  const modal = document.getElementById('share-team-modal');
  const urlInput = document.getElementById('share-link-input') as HTMLInputElement | null;
  if (urlInput) {
    urlInput.value = window.location.href;
  }
  if (modal) modal.classList.remove('hidden');
}

export function closeShareModal(): void {
  const modal = document.getElementById('share-team-modal');
  if (modal) modal.classList.add('hidden');
}

export function copyShareLink(): void {
  const urlInput = document.getElementById('share-link-input') as HTMLInputElement | null;
  const link = urlInput?.value || window.location.href;
  navigator.clipboard.writeText(link).then(() => {
    const copyBtnText = document.getElementById('copy-share-btn-text');
    if (copyBtnText) {
      copyBtnText.textContent = 'Copied!';
      setTimeout(() => {
        copyBtnText.textContent = 'Copy Link';
      }, 2000);
    }
    showToast('Workspace share link copied to clipboard!');
  }).catch(() => {
    showToast('Could not copy automatically. Please copy the link manually.');
  });
}

// --- User Profile & Team Management Modal ---
export function openUserTeamModal(): void {
  const modal = document.getElementById('user-team-modal');
  renderTeamMemberListInModal();
  if (modal) modal.classList.remove('hidden');
}

export function closeUserTeamModal(): void {
  const modal = document.getElementById('user-team-modal');
  if (modal) modal.classList.add('hidden');
}

function renderTeamMemberListInModal(): void {
  const container = document.getElementById('modal-team-list');
  if (!container) return;

  const userIsAdmin = isCurrentUserAdmin();

  // Control visibility of invite form vs locked notice
  const inviteNonAdminLocked = document.getElementById('invite-nonadmin-locked');
  const inviteMemberForm = document.getElementById('invite-member-form');
  const adminActionHint = document.getElementById('admin-action-hint');

  if (inviteNonAdminLocked && inviteMemberForm) {
    if (userIsAdmin) {
      inviteNonAdminLocked.classList.add('hidden');
      inviteMemberForm.classList.remove('opacity-50', 'pointer-events-none');
    } else {
      inviteNonAdminLocked.classList.remove('hidden');
      inviteMemberForm.classList.add('opacity-50', 'pointer-events-none');
    }
  }

  if (adminActionHint) {
    adminActionHint.textContent = userIsAdmin
      ? '👑 অ্যাডমিন মোড সক্রিয়: পদবী পরিবর্তন বা ইনভাইট করতে পারেন'
      : '🔒 মেম্বার ভিউ: শুধুমাত্র অ্যাডমিন পদবী পরিবর্তন ও ইনভাইট করতে পারেন';
  }

  if (teamMembers.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-white/5 text-center text-xs text-slate-400">
        টিমে কোনো মেম্বার পাওয়া যায়নি।
      </div>
    `;
    return;
  }

  container.innerHTML = teamMembers
    .map((member) => {
      const isSelected = currentUser.id === member.id || currentUser.email?.toLowerCase() === member.email?.toLowerCase();
      const isMemberAdmin = member.role === 'admin';
      const isOwner = member.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase();

      const missedCount = getMemberMissedTasks(member.name, member.email).length;
      const doneCount = getMemberCompletedTasks(member.name, member.email).length;

      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl ${
          isSelected
            ? 'bg-sky-500/15 border border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
            : 'bg-white/[0.04] border border-white/10 hover:border-white/20'
        } gap-2.5 transition-all">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-8 h-8 rounded-full bg-gradient-to-br ${
              member.avatarColor || (isMemberAdmin ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600')
            } text-slate-950 text-xs font-bold flex items-center justify-center shrink-0 shadow-xs">
              ${member.name.trim().charAt(0).toUpperCase()}
            </span>
            <div class="min-w-0">
              <div class="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                <span class="truncate">${escapeHtml(member.name)}</span>
                ${
                  isMemberAdmin
                    ? '<span class="px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-[10px] font-bold border border-amber-400/30 flex items-center gap-1">👑 Admin</span>'
                    : '<span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-medium border border-white/10">👤 Member</span>'
                }
                ${
                  isOwner
                    ? '<span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold border border-rose-500/30">Master</span>'
                    : ''
                }
                ${
                  isSelected
                    ? '<span class="px-1.5 py-0.5 rounded bg-sky-400/20 text-sky-300 text-[9px] font-bold border border-sky-400/30">Active</span>'
                    : ''
                }
                ${
                  missedCount > 0
                    ? `<span class="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[9px] font-bold border border-rose-500/30 flex items-center gap-1" title="${missedCount} task(s) missed deadline">⚠️ ${missedCount} Missed</span>`
                    : `<span class="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 text-[9px] font-medium border border-emerald-500/20">0 Missed</span>`
                }
              </div>
              <div class="text-[11px] text-slate-400 truncate">${escapeHtml(member.email)}</div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
            <!-- View Member Records Button -->
            <button
              type="button"
              data-action="view-member-records"
              data-member-name="${escapeHtml(member.name)}"
              class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-all cursor-pointer flex items-center gap-1"
              title="View completed & incomplete tasks"
            >
              <span>📋 Records</span>
              <span class="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 font-mono">${doneCount}✓ / ${missedCount}⚠</span>
            </button>

            ${
              userIsAdmin && !isOwner
                ? `
                <!-- Admin Role Toggle Button -->
                <button
                  type="button"
                  data-action="toggle-admin"
                  data-member-id="${member.id}"
                  class="px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                    isMemberAdmin
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
                  } transition-all cursor-pointer flex items-center gap-1"
                  title="${isMemberAdmin ? 'Demote to Member' : 'Promote to Admin'}"
                >
                  ${isMemberAdmin ? 'Demote to Member' : '👑 Make Admin'}
                </button>
                `
                : ''
            }

            <!-- Switch Active Profile Button -->
            <button
              type="button"
              data-action="switch-user"
              data-member-id="${member.id}"
              class="px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                isSelected
                  ? 'bg-sky-500 text-slate-950 font-bold'
                  : 'bg-white/10 text-slate-200 hover:bg-white/20'
              } transition-all cursor-pointer"
              title="Switch active profile"
            >
              ${isSelected ? 'Active' : 'Switch'}
            </button>

            ${
              userIsAdmin && !isOwner
                ? `
                <!-- Remove Member Button -->
                <button
                  type="button"
                  data-action="remove-member"
                  data-member-id="${member.id}"
                  class="p-1.5 text-[11px] font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 transition-all cursor-pointer"
                  title="Remove member from workspace"
                  aria-label="Remove member"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                `
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  // Bind Switch User
  container.querySelectorAll('[data-action="switch-user"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      const target = teamMembers.find((m) => m.id === memberId);
      if (!target) return;

      // If switching to an Admin account, require authenticated Google Sign In
      if (target.role === 'admin' || target.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()) {
        if (!auth.currentUser || auth.currentUser.email?.toLowerCase() !== target.email?.toLowerCase()) {
          const proceed = window.confirm(
            `👑 "${target.name}" একটি অ্যাডমিন অ্যাকাউন্ট। এই অ্যাকাউন্টে প্রবেশের জন্য Google Sign-In আবশ্যক। আপনি কি এখনই Google দিয়ে সাইন-ইন করতে চান?`
          );
          if (proceed) {
            handleGoogleSignIn();
          }
          return;
        }
      }

      saveCurrentUser(target);
      renderTeamMemberListInModal();
      showToast(`Active profile switched to "${target.name}"`);
    });
  });

  // Bind Role Toggle
  container.querySelectorAll('[data-action="toggle-admin"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      if (memberId) handleToggleMemberRole(memberId);
    });
  });

  // Bind Remove Member
  container.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      if (memberId) handleRemoveTeamMember(memberId);
    });
  });

  // Bind View Member Records
  container.querySelectorAll('[data-action="view-member-records"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberName = btn.getAttribute('data-member-name');
      if (memberName) {
        closeUserTeamModal();
        openTaskRecordsModal(memberName);
      }
    });
  });

  renderPendingInvitationsList();
}

export async function handleToggleMemberRole(memberId: string): Promise<void> {
  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    showToast('🔒 শুধুমাত্র অ্যাডমিন মেম্বারদের পদবী পরিবর্তন করতে পারবেন।', true);
    return;
  }

  const member = teamMembers.find((m) => m.id === memberId);
  if (!member) return;

  if (member.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()) {
    showToast('মাস্টার অ্যাডমিন Rokon Khan এর পদবী পরিবর্তন করা যাবে না।', true);
    return;
  }

  const newRole: 'admin' | 'member' = member.role === 'admin' ? 'member' : 'admin';
  member.role = newRole;
  member.avatarColor = newRole === 'admin' ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600';

  saveTeamMembers(teamMembers);
  renderTeamMemberListInModal();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  renderTaskList();

  showToast(`পদবী পরিবর্তন হয়েছে: "${member.name}" এখন ${newRole === 'admin' ? 'অ্যাডমিন 👑' : 'টিম মেম্বার 👤'}`);

  try {
    await setDoc(doc(db, 'teamMembers', member.id), member, { merge: true });
  } catch (err) {
    console.warn('Firestore member role update error:', err);
  }
}

export async function handleRemoveTeamMember(memberId: string): Promise<void> {
  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    showToast('🔒 শুধুমাত্র অ্যাডমিন মেম্বার রিমুভ করতে পারবেন।', true);
    return;
  }

  const member = teamMembers.find((m) => m.id === memberId);
  if (!member) return;

  if (member.email?.toLowerCase() === OWNER_ADMIN_EMAIL.toLowerCase()) {
    showToast('মাস্টার অ্যাডমিন Rokon Khan কে রিমুভ করা সম্ভব নয়।', true);
    return;
  }

  const confirmRemove = window.confirm(
    `আপনি কি নিশ্চিত যে "${member.name}" (${member.role === 'admin' ? 'Admin' : 'Member'}) কে টিম থেকে রিমুভ করতে চান?`
  );
  if (!confirmRemove) return;

  teamMembers = teamMembers.filter((m) => m.id !== memberId);
  saveTeamMembers(teamMembers);

  if (currentUser.id === memberId || currentUser.email?.toLowerCase() === member.email?.toLowerCase()) {
    currentUser = GUEST_USER;
    saveCurrentUser(GUEST_USER);
  }

  renderTeamMemberListInModal();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  renderTaskList();

  showToast(`"${member.name}" কে টিম থেকে রিমুভ করা হয়েছে।`);

  try {
    await deleteDoc(doc(db, 'teamMembers', memberId));
  } catch (err) {
    console.warn('Firestore member delete error:', err);
  }
}

export async function handleSendInvitation(e?: Event): Promise<void> {
  if (e) e.preventDefault();

  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    showToast('🔒 শুধুমাত্র অ্যাডমিন নতুন মেম্বারদের ইনভাইট করতে পারবেন।', true);
    return;
  }

  const nameInput = document.getElementById('new-member-name') as HTMLInputElement | null;
  const emailInput = document.getElementById('new-member-email') as HTMLInputElement | null;
  const roleSelect = document.getElementById('new-member-role') as HTMLSelectElement | null;

  const name = nameInput?.value.trim();
  const email = emailInput?.value.trim().toLowerCase();
  const role = (roleSelect?.value === 'admin' ? 'admin' : 'member') as 'admin' | 'member';

  if (!name) {
    showToast('অনুগ্রহ করে মেম্বারের নাম লিখুন।', true);
    return;
  }
  if (!email || !email.includes('@')) {
    showToast('অনুগ্রহ করে সঠিক ইমেইল ঠিকানা প্রদান করুন।', true);
    return;
  }

  const existingMember = teamMembers.find((m) => m.email?.toLowerCase() === email);
  if (existingMember) {
    showToast(`"${email}" ইতিমধ্যে টিম মেম্বার হিসেবে যুক্ত আছে।`, true);
    return;
  }

  const inviteId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const invitation: TeamInvitation = {
    id: inviteId,
    name,
    email,
    role,
    invitedBy: auth.currentUser?.email || OWNER_ADMIN_EMAIL,
    invitedByName: auth.currentUser?.displayName || 'Rokon Khan',
    status: 'pending',
    createdAt: Date.now(),
  };

  try {
    await setDoc(doc(db, 'teamInvitations', inviteId), invitation);
  } catch (err) {
    console.warn('Failed to save invitation to Firestore:', err);
  }

  // Update local pending array
  pendingInvitations = pendingInvitations.filter((i) => i.id !== inviteId);
  pendingInvitations.unshift(invitation);
  renderPendingInvitationsList();

  // Prepare Invite URL and Mailto link
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('invite', inviteId);
  currentUrl.searchParams.set('email', email);
  const inviteUrl = currentUrl.toString();

  const subject = encodeURIComponent(`Authority Park - টিম মেম্বার ইনভিটেশন (${role === 'admin' ? 'Admin' : 'Member'})`);
  const body = encodeURIComponent(
    `হ্যালো ${name},\n\nআপনাকে Authority Park টিম ওয়ার্কস্পেসে ${role === 'admin' ? 'অ্যাডমিন (Admin)' : 'টিম মেম্বার (Member)'} হিসেবে যুক্ত হতে আমন্ত্রণ জানানো হয়েছে।\n\nআমন্ত্রণ গ্রহণ করতে নিচের লিঙ্কে ক্লিক করুন এবং আপনার গুগল অ্যাকাউন্ট (${email}) দিয়ে সাইন-ইন সম্পন্ন করুন:\n\n${inviteUrl}\n\nধন্যবাদ,\n${auth.currentUser?.displayName || 'Rokon Khan'} (${auth.currentUser?.email || OWNER_ADMIN_EMAIL})\nAuthority Park Workspace`
  );
  const mailtoUrl = `mailto:${email}?subject=${subject}&body=${body}`;

  // Show Success Box
  const successBox = document.getElementById('invite-success-box');
  const successMsg = document.getElementById('invite-success-message');
  const mailtoBtn = document.getElementById('open-invite-mailto-btn') as HTMLAnchorElement | null;
  const copyBtn = document.getElementById('copy-invite-link-btn');

  if (successMsg) {
    successMsg.innerHTML = `<strong>${escapeHtml(name)}</strong> (${escapeHtml(email)}) এর জন্য <strong>${role === 'admin' ? '👑 Admin' : '👤 Member'}</strong> ইনভিটেশন তৈরি হয়েছে। নিচের লিঙ্ক বা ইমেইল অ্যাপ দিয়ে পাঠিয়ে দিন।`;
  }
  if (mailtoBtn) {
    mailtoBtn.href = mailtoUrl;
  }
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showToast('📋 ইনভিটেশন লিঙ্ক কপি করা হয়েছে! মেম্বারকে পাঠিয়ে দিন।');
      });
    };
  }
  if (successBox) {
    successBox.classList.remove('hidden');
  }

  // Reset inputs
  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (roleSelect) roleSelect.value = 'member';

  showToast(`📨 "${name}" এর জন্য ইনভিটেশন প্রস্তুত!`);
}

function renderPendingInvitationsList(): void {
  const container = document.getElementById('pending-invites-container');
  const list = document.getElementById('pending-invites-list');
  if (!container || !list) return;

  const userIsAdmin = isCurrentUserAdmin();
  const activePending = pendingInvitations.filter((inv) => inv.status === 'pending');

  if (activePending.length === 0) {
    container.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  container.classList.remove('hidden');
  list.innerHTML = activePending
    .map((inv) => {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?invite=${inv.id}&email=${encodeURIComponent(inv.email)}`;
      const subject = encodeURIComponent(`Authority Park টিম ইনভিটেশন`);
      const body = encodeURIComponent(`হ্যালো ${inv.name},\nআমন্ত্রণ লিঙ্ক:\n${inviteUrl}`);
      const mailtoUrl = `mailto:${inv.email}?subject=${subject}&body=${body}`;

      return `
        <div class="flex items-center justify-between p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs">
          <div class="min-w-0 flex items-center gap-2">
            <span class="w-6 h-6 rounded-full bg-amber-500/20 text-amber-300 font-bold text-[10px] flex items-center justify-center shrink-0">
              ✉️
            </span>
            <div class="min-w-0">
              <div class="text-white font-semibold flex items-center gap-1.5 truncate">
                <span>${escapeHtml(inv.name)}</span>
                <span class="px-1.5 py-0.2 rounded bg-slate-800 text-amber-300 text-[9px] font-bold border border-amber-400/30">
                  ${inv.role === 'admin' ? '👑 Admin' : '👤 Member'}
                </span>
              </div>
              <div class="text-[10px] text-slate-400 font-mono truncate">${escapeHtml(inv.email)}</div>
            </div>
          </div>
          <div class="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-action="copy-invite"
              data-url="${inviteUrl}"
              class="p-1 px-2 text-[10px] rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 transition-colors cursor-pointer"
              title="Copy invite URL"
            >
              📋 Link
            </button>
            <a
              href="${mailtoUrl}"
              target="_blank"
              class="p-1 px-2 text-[10px] rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 transition-colors flex items-center gap-1"
              title="Send mail"
            >
              ✉️ Mail
            </a>
            ${
              userIsAdmin
                ? `
                <button
                  type="button"
                  data-action="cancel-invite"
                  data-id="${inv.id}"
                  class="p-1 px-1.5 text-[10px] rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 transition-colors cursor-pointer"
                  title="Revoke invitation"
                >
                  ✕
                </button>
                `
                : ''
            }
          </div>
        </div>
      `;
    })
    .join('');

  list.querySelectorAll('[data-action="copy-invite"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          showToast('📋 ইনভিটেশন লিঙ্ক কপি করা হয়েছে!');
        });
      }
    });
  });

  list.querySelectorAll('[data-action="cancel-invite"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (id) handleCancelInvitation(id);
    });
  });
}

export async function handleCancelInvitation(inviteId: string): Promise<void> {
  if (!isCurrentUserAdmin()) {
    showAdminRestrictedNotice();
    return;
  }
  pendingInvitations = pendingInvitations.filter((i) => i.id !== inviteId);
  renderPendingInvitationsList();
  showToast('ইনভিটেশন বাতিল করা হয়েছে।');
  try {
    await deleteDoc(doc(db, 'teamInvitations', inviteId));
  } catch (e) {
    console.warn('Error deleting invitation doc:', e);
  }
}

async function checkUrlInvitationParam(): Promise<void> {
  const urlParams = new URLSearchParams(window.location.search);
  const inviteId = urlParams.get('invite');
  if (!inviteId) return;

  try {
    const inviteDoc = await getDoc(doc(db, 'teamInvitations', inviteId));
    if (inviteDoc.exists()) {
      const data = inviteDoc.data() as TeamInvitation;
      if (data.status === 'pending') {
        activeUrlInvitation = { ...data, id: inviteId };
        showInviteAcceptModal(activeUrlInvitation);
      } else if (data.status === 'accepted') {
        showToast('এই ইনভিটেশনটি ইতিমধ্যে গ্রহণ করা হয়েছে।');
      }
    }
  } catch (err) {
    console.warn('Failed to verify invitation param:', err);
  }
}

function showInviteAcceptModal(invitation: TeamInvitation): void {
  const modal = document.getElementById('invite-accept-modal');
  const inviterEl = document.getElementById('invite-inviter-display');
  const emailEl = document.getElementById('invite-email-display');
  const roleEl = document.getElementById('invite-role-display');
  const welcomeText = document.getElementById('invite-welcome-text');

  if (inviterEl) inviterEl.textContent = invitation.invitedByName || 'Rokon Khan (Admin)';
  if (emailEl) emailEl.textContent = invitation.email;
  if (roleEl) {
    roleEl.textContent = invitation.role === 'admin' ? '👑 Admin' : '👤 Team Member';
    roleEl.className = invitation.role === 'admin' ? 'font-bold text-amber-300' : 'font-bold text-emerald-400';
  }
  if (welcomeText) {
    welcomeText.textContent = `আপনাকে "${invitation.invitedByName || 'Rokon Khan'}" Authority Park টিম ওয়ার্কস্পেসে ${invitation.role === 'admin' ? 'অ্যাডমিন' : 'মেম্বার'} হিসেবে যুক্ত হতে আমন্ত্রণ জানিয়েছেন।`;
  }

  if (modal) modal.classList.remove('hidden');
}

export async function handleAcceptInvitationWithGoogle(): Promise<void> {
  if (!activeUrlInvitation) {
    handleGoogleSignIn();
    return;
  }

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (!user || !user.email) return;

    const userEmail = user.email.toLowerCase();
    const targetEmail = activeUrlInvitation.email.toLowerCase();

    const isMaster = userEmail === OWNER_ADMIN_EMAIL.toLowerCase();
    const isInvited = userEmail === targetEmail;

    if (!isInvited && !isMaster) {
      alert(
        `⚠️ ইনভিটেশন অমিল:\n\nএই ইনভিটেশনটি পাঠানো হয়েছিল: "${activeUrlInvitation.email}"-এর জন্য।\nআপনি সাইন-ইন করেছেন: "${user.email}" দিয়ে।\n\nঅনুগ্রহ করে আমন্ত্রিত গুগল অ্যাকাউন্ট দিয়ে সাইন-ইন করুন।`
      );
      return;
    }

    const assignedRole = isMaster ? 'admin' : activeUrlInvitation.role;
    const memberName = user.displayName || activeUrlInvitation.name || userEmail.split('@')[0];

    const newMember: TeamMember = {
      id: `user_${user.uid}`,
      name: memberName,
      email: user.email,
      role: assignedRole,
      avatarColor: assignedRole === 'admin' ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600',
    };

    const existingIndex = teamMembers.findIndex((m) => m.email?.toLowerCase() === userEmail);
    if (existingIndex >= 0) {
      teamMembers[existingIndex] = { ...teamMembers[existingIndex], role: assignedRole, name: memberName };
    } else {
      teamMembers.push(newMember);
    }
    saveTeamMembers(teamMembers);
    saveCurrentUser(newMember);

    try {
      await updateDoc(doc(db, 'teamInvitations', activeUrlInvitation.id), {
        status: 'accepted',
        acceptedAt: Date.now(),
        acceptedByUid: user.uid,
      });
      await setDoc(doc(db, 'teamMembers', newMember.id), newMember, { merge: true });
    } catch (e) {
      console.warn('Firestore sync error during invite accept:', e);
    }

    const modal = document.getElementById('invite-accept-modal');
    if (modal) modal.classList.add('hidden');
    window.history.replaceState({}, document.title, window.location.pathname);
    activeUrlInvitation = null;

    showToast(`🎉 স্বাগতম ${memberName}! আপনি সফলভাবে ${assignedRole === 'admin' ? 'Admin 👑' : 'Member 👤'} হিসেবে যুক্ত হয়েছেন।`);
  } catch (err) {
    console.error('Google Sign In Error:', err);
    showToast('Google Sign In cancelled or failed.');
  }
}

export async function handleGoogleSignIn(): Promise<void> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (user && user.email) {
      const emailLower = user.email.toLowerCase();
      const isMasterAdmin = emailLower === OWNER_ADMIN_EMAIL.toLowerCase();

      const pendingInvite = pendingInvitations.find((i) => i.email?.toLowerCase() === emailLower && i.status === 'pending');

      let role: 'admin' | 'member' = 'member';
      if (isMasterAdmin) {
        role = 'admin';
      } else if (pendingInvite) {
        role = pendingInvite.role;
        updateDoc(doc(db, 'teamInvitations', pendingInvite.id), {
          status: 'accepted',
          acceptedAt: Date.now(),
          acceptedByUid: user.uid,
        }).catch(console.warn);
      } else {
        const existing = teamMembers.find((m) => m.email?.toLowerCase() === emailLower);
        if (existing) {
          role = existing.role;
        }
      }

      const activeProfile: TeamMember = {
        id: `user_${user.uid}`,
        name: isMasterAdmin ? 'Rokon Khan (Admin)' : (user.displayName || user.email.split('@')[0]),
        email: user.email,
        role: role,
        avatarColor: role === 'admin' ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600',
      };

      const existingIndex = teamMembers.findIndex((m) => m.email?.toLowerCase() === emailLower);
      if (existingIndex >= 0) {
        teamMembers[existingIndex] = activeProfile;
      } else {
        teamMembers.push(activeProfile);
      }

      saveTeamMembers(teamMembers);
      saveCurrentUser(activeProfile);
      setDoc(doc(db, 'teamMembers', activeProfile.id), activeProfile, { merge: true }).catch(console.warn);

      closeUserTeamModal();
      if (isMasterAdmin) {
        showToast('👑 স্বাগতম Rokon Khan! আপনি মাস্টার অ্যাডমিন হিসেবে সাইন-ইন করেছেন।');
      } else {
        showToast(`Signed in as ${activeProfile.name} (${role === 'admin' ? 'Admin 👑' : 'Member 👤'})`);
      }
    }
  } catch (err) {
    console.error('Google Sign In Error:', err);
    showToast('Google Sign In cancelled or failed.');
  }
}

export async function handleSignOut(): Promise<void> {
  try {
    await signOut(auth);
    currentUser = GUEST_USER;
    localStorage.removeItem(CURRENT_USER_KEY);
    updateCurrentUserHeaderBadge();
    renderTeamMemberListInModal();
    renderAssigneeSelectOptions();
    renderSidebarAssigneeFilters();
    renderTaskList();
    showToast('সফলভাবে সাইন-আউট হয়েছে।');
  } catch (err) {
    console.warn('Sign Out Error:', err);
  }
}

// --- Standalone HTML Generator ---
export function handleDownloadStandaloneHtml(): void {
  const fullHtml = '<!doctype html>\n' + document.documentElement.outerHTML;
  const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'daily-work-tracker-team.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded standalone daily-work-tracker-team.html');
}

// --- 3-Month Data Retention Cleanup ---
export async function cleanupExpiredCompletedTasks(): Promise<void> {
  const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - THREE_MONTHS_MS;
  const expired = tasks.filter((t) => t.status === 'Done' && (t.completedAt || t.updatedAt) < cutoff);

  if (expired.length > 0) {
    tasks = tasks.filter((t) => !(t.status === 'Done' && (t.completedAt || t.updatedAt) < cutoff));
    saveTasksToStorage(tasks);
    for (const exp of expired) {
      deleteDoc(doc(db, 'tasks', exp.id)).catch(console.warn);
    }
  }
}

// --- Work Calendar Modal (Completion Tracker with 3-Month Retention) ---
let calendarActiveMonth: Date = new Date();
let calendarMemberFilter: string = 'all';
let calendarSelectedDayStr: string = new Date().toISOString().split('T')[0];

export function openWorkCalendarModal(): void {
  const modal = document.getElementById('work-calendar-modal');
  if (!modal) return;
  renderAssigneeSelectOptions();
  const filterSelect = document.getElementById('calendar-member-filter') as HTMLSelectElement | null;
  if (filterSelect) {
    filterSelect.value = calendarMemberFilter;
  }
  renderWorkCalendar();
  modal.classList.remove('hidden');
}

export function closeWorkCalendarModal(): void {
  const modal = document.getElementById('work-calendar-modal');
  if (modal) modal.classList.add('hidden');
}

export function renderWorkCalendar(): void {
  const gridContainer = document.getElementById('calendar-days-grid');
  const monthDisplay = document.getElementById('calendar-month-display');
  const dayPanel = document.getElementById('calendar-selected-day-panel');
  if (!gridContainer || !monthDisplay || !dayPanel) return;

  const year = calendarActiveMonth.getFullYear();
  const month = calendarActiveMonth.getMonth(); // 0-indexed

  // Format month heading
  monthDisplay.textContent = calendarActiveMonth.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
  const totalMonthSecs = getMemberMonthlyTrackedSeconds(calendarMemberFilter, monthKey);
  const monthTotalEl = document.getElementById('calendar-monthly-total-work-time');
  if (monthTotalEl) {
    monthTotalEl.textContent = `মাসিক মোট কাজ: ${formatTotalTime(totalMonthSecs)}`;
  }

  // 3-Month Retention Cutoff (90 days ago)
  const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
  const retentionCutoff = Date.now() - THREE_MONTHS_MS;

  // Filter completed tasks within 3-month retention and member filter
  const eligibleCompletedTasks = tasks.filter((task) => {
    if (task.status !== 'Done') return false;
    const completedTs = task.completedAt || task.updatedAt;
    if (completedTs < retentionCutoff) return false;
    if (calendarMemberFilter !== 'all') {
      const match = task.assigneeName === calendarMemberFilter;
      if (!match) return false;
    }
    return true;
  });

  // Group completed tasks by completion date "YYYY-MM-DD"
  const completionsByDate: Record<string, Task[]> = {};
  eligibleCompletedTasks.forEach((task) => {
    const ts = task.completedAt || task.updatedAt;
    const dateStr = new Date(ts).toISOString().split('T')[0];
    if (!completionsByDate[dateStr]) completionsByDate[dateStr] = [];
    completionsByDate[dateStr].push(task);
  });

  // Calculate calendar grid days
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = new Date().toISOString().split('T')[0];

  let cellsHtml = '';

  // Blank padding cells for days before the 1st
  for (let i = 0; i < firstDayIndex; i++) {
    cellsHtml += `<div class="min-h-[72px] sm:min-h-[86px] p-1.5 rounded-xl bg-white/[0.01] border border-white/[0.02] opacity-30 pointer-events-none"></div>`;
  }

  // Days of current month
  for (let day = 1; day <= daysInMonth; day++) {
    const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTasks = completionsByDate[dayStr] || [];
    const count = dayTasks.length;
    const dailyWorkSecs = getDailyWorkSeconds(dayStr, calendarMemberFilter);
    const isToday = dayStr === todayStr;
    const isSelected = dayStr === calendarSelectedDayStr;

    cellsHtml += `
      <div
        data-date="${dayStr}"
        class="calendar-day-cell group min-h-[72px] sm:min-h-[86px] p-2 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
          isSelected
            ? 'bg-sky-500/20 border-sky-400 shadow-[0_0_15px_rgba(56,189,248,0.25)] ring-1 ring-sky-400'
            : isToday
              ? 'bg-amber-500/10 border-amber-400/40 hover:border-amber-400/70'
              : count > 0 || dailyWorkSecs > 0
                ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/60'
                : 'bg-white/[0.02] border-white/5 hover:border-white/20 hover:bg-white/[0.05]'
        }"
      >
        <div class="flex items-center justify-between">
          <span class="text-xs font-bold ${
            isToday
              ? 'text-amber-300 font-extrabold'
              : isSelected
                ? 'text-sky-300'
                : 'text-slate-300'
          }">
            ${day}
          </span>
          ${
            isToday
              ? '<span class="text-[9px] px-1 py-0.2 rounded bg-amber-400/20 text-amber-300 font-bold">আজ</span>'
              : ''
          }
        </div>

        <div class="mt-1 space-y-1">
          ${
            dailyWorkSecs > 0
              ? `
              <div class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[9px] font-mono font-bold">
                <svg class="w-2.5 h-2.5 text-sky-400 shrink-0" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>
                <span class="truncate">${formatMinutesToDuration(Math.round(dailyWorkSecs / 60))}</span>
              </div>
              `
              : ''
          }
          ${
            count > 0
              ? `
              <div class="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold">
                <svg class="w-3 h-3 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />
                </svg>
                <span class="truncate">${count} Done</span>
              </div>
              `
              : dailyWorkSecs === 0
                ? `
              <span class="text-[10px] text-slate-400/40 opacity-0 group-hover:opacity-100 transition-opacity">
                0 Done
              </span>
              `
                : ''
          }
        </div>
      </div>
    `;
  }

  gridContainer.innerHTML = cellsHtml;

  // Add click handlers to cells
  gridContainer.querySelectorAll('.calendar-day-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const selected = cell.getAttribute('data-date');
      if (selected) {
        calendarSelectedDayStr = selected;
        renderWorkCalendar();
      }
    });
  });

  // Render Selected Day Tasks Panel
  const selectedDayTasks = completionsByDate[calendarSelectedDayStr] || [];
  const selectedDateObj = new Date(calendarSelectedDayStr + 'T00:00:00');
  const formattedSelectedDate = selectedDateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  if (selectedDayTasks.length === 0) {
    dayPanel.innerHTML = `
      <div class="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-center space-y-1.5">
        <div class="text-xs font-semibold text-slate-300">📅 ${formattedSelectedDate}</div>
        <p class="text-xs text-slate-400">এই তারিখে কোনো কাজ সম্পন্ন করা হয়নি বা ৩ মাসের অধিক পুরাতন।</p>
      </div>
    `;
  } else {
    dayPanel.innerHTML = `
      <div class="space-y-2">
        <div class="flex items-center justify-between pb-1 border-b border-white/10">
          <div class="text-xs font-bold text-white flex items-center gap-2">
            <span>📅 ${formattedSelectedDate}</span>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              ${selectedDayTasks.length} টি কাজ সম্পন্ন
            </span>
          </div>
          <span class="text-[11px] text-slate-400">
            ${calendarMemberFilter === 'all' ? 'সকল টিম মেম্বার' : escapeHtml(calendarMemberFilter)}
          </span>
        </div>

        <div class="space-y-2 max-h-56 overflow-y-auto pr-1">
          ${selectedDayTasks
            .map((task) => {
              const completedTimeStr = new Date(task.completedAt || task.updatedAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
              });
              const member = teamMembers.find((m) => m.name === task.assigneeName);
              const avatarColor = member?.avatarColor || 'from-sky-400 to-blue-600';
              const initial = (task.assigneeName || 'U').trim().charAt(0).toUpperCase();

              return `
                <div class="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3 hover:border-emerald-500/30 transition-all">
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-6 h-6 rounded-full bg-gradient-to-br ${avatarColor} text-slate-950 text-[10px] font-bold flex items-center justify-center shrink-0">
                      ${initial}
                    </span>
                    <div class="min-w-0">
                      <div class="text-xs font-semibold text-white truncate flex items-center gap-1.5">
                        <span class="truncate">${escapeHtml(task.title)}</span>
                        ${getPriorityBadgeHtml(task.priority)}
                      </div>
                      <div class="text-[11px] text-slate-400 flex items-center gap-2">
                        <span>সম্পন্ন করেছেন: <strong class="text-slate-300">${escapeHtml(task.assigneeName || 'Unassigned')}</strong></span>
                        <span>•</span>
                        <span>সময়: ${completedTimeStr}</span>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center gap-1.5 shrink-0">
                    <span class="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                      ⏱ ${formatTimerDisplay(task.timeSpentSeconds)}
                    </span>
                  </div>
                </div>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }
}

// --- Task Records Modal (Completed vs Missed Tracker with Account Removal) ---
let recordsActiveTab: 'missed' | 'completed' = 'missed';
let recordsActiveMemberName: string = '';

export function openTaskRecordsModal(targetMemberName?: string): void {
  const modal = document.getElementById('task-records-modal');
  if (!modal) return;

  renderAssigneeSelectOptions();

  const userIsAdmin = isCurrentUserAdmin();
  const select = document.getElementById('records-member-select') as HTMLSelectElement | null;
  const permissionHint = document.getElementById('records-admin-permission-hint');

  if (targetMemberName) {
    recordsActiveMemberName = targetMemberName;
  } else if (!recordsActiveMemberName) {
    recordsActiveMemberName = currentUser.name;
  }

  if (select) {
    select.value = recordsActiveMemberName;
    if (!userIsAdmin) {
      select.disabled = true;
      if (permissionHint) {
        permissionHint.textContent = '🔒 আপনি শুধুমাত্র আপনার অ্যাকাউন্টের রেকর্ড দেখতে ও পরিচালনা করতে পারবেন।';
      }
    } else {
      select.disabled = false;
      if (permissionHint) {
        permissionHint.textContent = '👑 অ্যাডমিন মোড: যেকোনো মেম্বারের অসম্পূর্ণ ও সম্পন্ন রেকর্ড পর্যালোচনা ও পরিচালনা করুন।';
      }
    }
  }

  renderTaskRecordsModal(recordsActiveMemberName);
  modal.classList.remove('hidden');
}

export function closeTaskRecordsModal(): void {
  const modal = document.getElementById('task-records-modal');
  if (modal) modal.classList.add('hidden');
}

export function renderTaskRecordsModal(memberName?: string): void {
  const selectedName = memberName || recordsActiveMemberName || currentUser.name;
  recordsActiveMemberName = selectedName;

  const targetMember = teamMembers.find((m) => m.name === selectedName);
  const memberEmail = targetMember?.email;

  const missedTasks = getMemberMissedTasks(selectedName, memberEmail);
  const completedTasks = getMemberCompletedTasks(selectedName, memberEmail);

  // Update counters in modal header
  const missedCountEl = document.getElementById('records-missed-count');
  const doneCountEl = document.getElementById('records-done-count');
  const missedBadge = document.getElementById('tab-records-missed-badge');
  const doneBadge = document.getElementById('tab-records-completed-badge');

  if (missedCountEl) missedCountEl.textContent = missedTasks.length.toString();
  if (doneCountEl) doneCountEl.textContent = completedTasks.length.toString();
  if (missedBadge) missedBadge.textContent = missedTasks.length.toString();
  if (doneBadge) doneBadge.textContent = completedTasks.length.toString();

  // Highlight active tab
  const tabMissed = document.getElementById('tab-records-missed');
  const tabDone = document.getElementById('tab-records-completed');
  if (tabMissed && tabDone) {
    if (recordsActiveTab === 'missed') {
      tabMissed.className = 'tab-btn flex-1 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 bg-rose-500/20 text-rose-300 border border-rose-500/30 shadow-[0_0_12px_rgba(244,63,94,0.2)]';
      tabDone.className = 'tab-btn flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-2';
    } else {
      tabMissed.className = 'tab-btn flex-1 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-2';
      tabDone.className = 'tab-btn flex-1 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.2)]';
    }
  }

  const container = document.getElementById('records-list-container');
  if (!container) return;

  if (recordsActiveTab === 'missed') {
    if (missedTasks.length === 0) {
      container.innerHTML = `
        <div class="p-8 rounded-2xl bg-white/[0.02] border border-white/5 text-center space-y-3">
          <div class="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto text-xl font-bold">
            ✓
          </div>
          <div class="text-sm font-bold text-white">চমৎকার! কোনো অসম্পূর্ণ বা মিসড টাস্ক নেই</div>
          <p class="text-xs text-slate-400 max-w-md mx-auto">
            ${escapeHtml(selectedName)} এর কোনো টাস্কের ডেডলাইন পার হয়ে কাজ অসম্পূর্ণ থাকেনি।
          </p>
        </div>
      `;
      return;
    }

    container.innerHTML = missedTasks
      .map((task) => {
        return `
          <div class="p-4 rounded-2xl bg-rose-500/[0.04] border border-rose-500/20 hover:border-rose-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1.5 min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-bold text-white">${escapeHtml(task.title)}</span>
                ${getPriorityBadgeHtml(task.priority)}
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                  ⚠️ ডেডলাইন মিসড
                </span>
              </div>
              <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                ${task.startDate ? `<span>শুরু: <strong class="text-slate-300">${task.startDate}</strong></span>` : ''}
                <span class="text-rose-400 font-semibold">ডেডলাইন: ${task.deadline || 'N/A'}</span>
                <span>বর্তমান স্ট্যাটাস: <strong class="text-amber-300">${task.status}</strong></span>
                <span>ট্র্যাক করা সময়: <strong class="font-mono text-slate-300">${formatTimerDisplay(task.timeSpentSeconds)}</strong></span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-action="remove-task-from-account"
                data-task-id="${task.id}"
                class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 hover:border-rose-500/50 transition-all cursor-pointer flex items-center gap-1.5"
                title="এই টাস্কটি মেম্বারের অ্যাকাউন্ট রেকর্ড ও তালিকা থেকে মুছে ফেলুন"
              >
                <svg class="w-3.5 h-3.5 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>অ্যাকাউন্ট থেকে মুছুন</span>
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  } else {
    // Completed Tab
    if (completedTasks.length === 0) {
      container.innerHTML = `
        <div class="p-8 rounded-2xl bg-white/[0.02] border border-white/5 text-center space-y-2">
          <div class="text-sm font-semibold text-slate-300">কোনো সম্পন্ন টাস্কের রেকর্ড নেই</div>
          <p class="text-xs text-slate-400">এই মেম্বারের সম্পূর্ণ হওয়া কোনো কাজের রেকর্ড এখনো যোগ হয়নি।</p>
        </div>
      `;
      return;
    }

    container.innerHTML = completedTasks
      .map((task) => {
        const completedDateStr = new Date(task.completedAt || task.updatedAt).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        return `
          <div class="p-4 rounded-2xl bg-emerald-500/[0.03] border border-emerald-500/15 hover:border-emerald-500/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="space-y-1.5 min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-sm font-bold text-white line-through opacity-80">${escapeHtml(task.title)}</span>
                ${getPriorityBadgeHtml(task.priority)}
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  ✓ সম্পন্ন
                </span>
              </div>
              <div class="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                <span>সম্পন্ন তারিখ: <strong class="text-emerald-300 font-semibold">${completedDateStr}</strong></span>
                ${task.deadline ? `<span>ডেডলাইন ছিল: ${task.deadline}</span>` : ''}
                <span>মোট সময়: <strong class="font-mono text-slate-300">${formatTimerDisplay(task.timeSpentSeconds)}</strong></span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <button
                type="button"
                data-action="remove-task-from-account"
                data-task-id="${task.id}"
                class="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 hover:border-white/20 transition-all cursor-pointer flex items-center gap-1.5"
                title="এই টাস্কটি মেম্বারের অ্যাকাউন্ট রেকর্ড থেকে মুছে ফেলুন"
              >
                <svg class="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <span>রেকর্ড থেকে মুছুন</span>
              </button>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Bind Remove from Account buttons
  container.querySelectorAll('[data-action="remove-task-from-account"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      if (taskId) {
        handleRemoveTaskFromAccount(taskId, recordsActiveMemberName);
      }
    });
  });
}

export async function handleRemoveTaskFromAccount(taskId: string, memberName: string): Promise<void> {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  if (!task.hiddenForUsers) {
    task.hiddenForUsers = [];
  }

  if (!task.hiddenForUsers.includes(memberName)) {
    task.hiddenForUsers.push(memberName);
  }

  const member = teamMembers.find((m) => m.name === memberName);
  if (member?.email && !task.hiddenForUsers.includes(member.email)) {
    task.hiddenForUsers.push(member.email);
  }

  task.updatedAt = Date.now();
  saveTasksToStorage(tasks);
  updateDailyOverview();
  renderTaskList();
  updateCurrentUserHeaderBadge();
  renderTaskRecordsModal(memberName);
  renderWorkCalendar();

  showToast(`টাস্কটি "${memberName}"-এর অ্যাকাউন্ট রেকর্ড ও ভিউ থেকে মুছে ফেলা হয়েছে`);

  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      hiddenForUsers: task.hiddenForUsers,
      updatedAt: task.updatedAt,
    });
  } catch (err) {
    console.warn('Firestore task account removal sync error:', err);
  }
}

// --- Global Event Listeners Setup ---
function setupEventListeners(): void {
  // Mobile Sidebar Toggles
  const sidebarToggle = document.getElementById('mobile-sidebar-toggle');
  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  sidebarToggle?.addEventListener('click', openSidebar);
  closeSidebarBtn?.addEventListener('click', closeSidebar);
  sidebarBackdrop?.addEventListener('click', closeSidebar);

  // Status Filter Buttons
  const statusFilterBtns = document.querySelectorAll('.filter-status-btn');
  statusFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const status = btn.getAttribute('data-filter-status') || 'all';
      currentFilterStatus = status as 'all' | TaskStatus;
      renderTaskList();
      if (window.innerWidth < 1024) closeSidebar();
    });
  });

  // Priority Filter Buttons
  const priorityFilterBtns = document.querySelectorAll('.filter-priority-btn');
  priorityFilterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const priority = btn.getAttribute('data-filter-priority') || 'all';
      currentFilterPriority = priority as 'all' | PriorityLevel;
      renderTaskList();
      if (window.innerWidth < 1024) closeSidebar();
    });
  });

  // Add Task Form
  const entryForm = document.getElementById('task-entry-form');
  entryForm?.addEventListener('submit', handleAddTask);

  // Time Preset Chips
  const presetChips = document.querySelectorAll('.time-preset-chip');
  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const mins = chip.getAttribute('data-mins');
      const estInput = document.getElementById('task-estimated-input') as HTMLInputElement | null;
      if (estInput && mins) {
        estInput.value = mins;
        estInput.focus();
      }
    });
  });

  // Search Input
  const searchInput = document.getElementById('task-search-input') as HTMLInputElement | null;
  searchInput?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    renderTaskList();
  });

  // Sort Select
  const sortSelect = document.getElementById('task-sort-select') as HTMLSelectElement | null;
  sortSelect?.addEventListener('change', (e) => {
    currentSortOrder = (e.target as HTMLSelectElement).value as any;
    renderTaskList();
  });

  // Quick Filter Reset
  const resetFilterQuickBtn = document.getElementById('reset-filter-quick-btn');
  resetFilterQuickBtn?.addEventListener('click', () => {
    (window as any).resetAllFilters();
  });

  // Task List Delegation
  const taskListContainer = document.getElementById('task-list-container');
  taskListContainer?.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-action]');
    if (!target) return;

    const action = target.getAttribute('data-action');
    const taskId = target.getAttribute('data-id');
    if (!taskId) return;

    if (action === 'toggle-status') {
      const task = tasks.find((t) => t.id === taskId);
      if (task) {
        const nextStatus: TaskStatus = task.status === 'Done' ? 'To Do' : 'Done';
        handleUpdateTaskStatus(taskId, nextStatus);
      }
    } else if (action === 'toggle-timer') {
      handleToggleTaskTimer(taskId);
    } else if (action === 'start') {
      handleUpdateTaskStatus(taskId, 'In Progress');
    } else if (action === 'done') {
      handleUpdateTaskStatus(taskId, 'Done');
    } else if (action === 'reopen') {
      handleUpdateTaskStatus(taskId, 'To Do');
    } else if (action === 'edit') {
      openEditModal(taskId);
    } else if (action === 'delete') {
      handleDeleteTask(taskId);
    } else if (action === 'restricted-delete') {
      showAdminRestrictedNotice();
    }
  });

  // Status dropdown change in task list
  taskListContainer?.addEventListener('change', (e) => {
    const target = e.target as HTMLSelectElement | null;
    if (target && target.classList.contains('status-dropdown-select')) {
      const taskId = target.getAttribute('data-id');
      const newStatus = target.value as TaskStatus;
      if (taskId && newStatus) {
        handleUpdateTaskStatus(taskId, newStatus);
      }
    }
  });

  // Edit Modal Form and Controls
  const editForm = document.getElementById('edit-task-form');
  const closeEditBtn = document.getElementById('close-edit-modal-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');
  const editModal = document.getElementById('edit-modal');
  const editResetTimeBtn = document.getElementById('edit-reset-time-btn');

  editResetTimeBtn?.addEventListener('click', () => {
    const timeInput = document.getElementById('edit-task-time-minutes') as HTMLInputElement | null;
    if (timeInput) {
      timeInput.value = '0';
      timeInput.focus();
    }
  });

  closeEditBtn?.addEventListener('click', closeEditModal);
  cancelEditBtn?.addEventListener('click', closeEditModal);
  editModal?.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
  });
  editForm?.addEventListener('submit', handleSaveEdit);

  // Share Modal Controls
  const shareBtn = document.getElementById('share-team-btn');
  const closeShareBtn = document.getElementById('close-share-modal-btn');
  const shareModal = document.getElementById('share-team-modal');
  const copyShareBtn = document.getElementById('copy-share-btn');

  shareBtn?.addEventListener('click', openShareModal);
  closeShareBtn?.addEventListener('click', closeShareModal);
  shareModal?.addEventListener('click', (e) => {
    if (e.target === shareModal) closeShareModal();
  });
  copyShareBtn?.addEventListener('click', copyShareLink);

  // User Profile / Team Modal Controls
  const userProfileBtn = document.getElementById('user-profile-btn');
  const closeUserTeamBtn = document.getElementById('close-user-team-modal-btn');
  const userTeamModal = document.getElementById('user-team-modal');
  const inviteMemberForm = document.getElementById('invite-member-form');
  const googleSignInBtn = document.getElementById('google-signin-btn');
  const googleSignOutBtn = document.getElementById('google-signout-btn');
  const headerGoogleAuthBtn = document.getElementById('header-google-auth-btn');
  const manageTeamSidebarBtn = document.getElementById('manage-team-sidebar-btn');
  const closeInviteSuccessBtn = document.getElementById('close-invite-success-btn');

  // Invitation Accept Modal Controls
  const acceptInviteGoogleBtn = document.getElementById('invite-accept-google-btn');
  const closeInviteModalBtn = document.getElementById('close-invite-modal-btn');
  const declineInviteBtn = document.getElementById('decline-invite-btn');
  const inviteAcceptModal = document.getElementById('invite-accept-modal');

  userProfileBtn?.addEventListener('click', openUserTeamModal);
  manageTeamSidebarBtn?.addEventListener('click', openUserTeamModal);
  closeUserTeamBtn?.addEventListener('click', closeUserTeamModal);
  userTeamModal?.addEventListener('click', (e) => {
    if (e.target === userTeamModal) closeUserTeamModal();
  });

  inviteMemberForm?.addEventListener('submit', handleSendInvitation);
  closeInviteSuccessBtn?.addEventListener('click', () => {
    const successBox = document.getElementById('invite-success-box');
    if (successBox) successBox.classList.add('hidden');
  });

  googleSignInBtn?.addEventListener('click', handleGoogleSignIn);
  googleSignOutBtn?.addEventListener('click', handleSignOut);
  headerGoogleAuthBtn?.addEventListener('click', () => {
    if (auth.currentUser) {
      if (window.confirm('আপনি কি নিশ্চিত যে অ্যাকাউন্ট থেকে সাইন-আউট করতে চান?')) {
        handleSignOut();
      }
    } else {
      handleGoogleSignIn();
    }
  });

  acceptInviteGoogleBtn?.addEventListener('click', handleAcceptInvitationWithGoogle);
  closeInviteModalBtn?.addEventListener('click', () => inviteAcceptModal?.classList.add('hidden'));
  declineInviteBtn?.addEventListener('click', () => inviteAcceptModal?.classList.add('hidden'));

  // Admin Restricted Notice Modal Close
  const closeRestrictedBtn = document.getElementById('close-restricted-modal-btn');
  const closeRestrictedX = document.getElementById('close-restricted-modal-x');
  const restrictedModal = document.getElementById('admin-restricted-modal');
  closeRestrictedBtn?.addEventListener('click', () => restrictedModal?.classList.add('hidden'));
  closeRestrictedX?.addEventListener('click', () => restrictedModal?.classList.add('hidden'));

  // Sidebar utility buttons
  const clearCompletedBtn = document.getElementById('clear-completed-btn');
  const resetSampleBtn = document.getElementById('reset-sample-btn');
  clearCompletedBtn?.addEventListener('click', handleClearCompleted);
  resetSampleBtn?.addEventListener('click', () => {
    if (window.confirm('Reset task list to default workspace sample tasks?')) {
      tasks = JSON.parse(JSON.stringify(DEFAULT_SAMPLE_TASKS));
      saveTasksToStorage(tasks);
      updateDailyOverview();
      renderTaskList();
      showToast('Sample tasks restored');
      // Sync all samples to Firestore
      tasks.forEach((t) => setDoc(doc(db, 'tasks', t.id), t).catch(console.error));
    }
  });

  // Standalone Download
  const downloadHtmlBtn = document.getElementById('download-html-btn');
  downloadHtmlBtn?.addEventListener('click', handleDownloadStandaloneHtml);

  // Toast Close
  const toastCloseBtn = document.getElementById('toast-close-btn');
  toastCloseBtn?.addEventListener('click', () => {
    const toast = document.getElementById('toast-notification');
    toast?.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
  });

  // Brand Logo Click to Upload & Auto Background Removal
  const brandLogoContainer = document.getElementById('brand-logo-container');
  const logoFileInput = document.getElementById('authority-park-logo-input') as HTMLInputElement | null;

  brandLogoContainer?.addEventListener('click', () => {
    logoFileInput?.click();
  });

  logoFileInput?.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const rawSrc = event.target?.result as string;
        if (!rawSrc) return;

        showToast('লোগোর ব্যাকগ্রাউন্ড প্রসেস ও রিমুভ করা হচ্ছে...');
        const transparentDataUrl = await processImageRemoveBackground(rawSrc);

        localStorage.setItem(LOGO_STORAGE_KEY, transparentDataUrl);
        const logoImg = document.getElementById('authority-park-logo-img') as HTMLImageElement | null;
        if (logoImg) {
          logoImg.src = transparentDataUrl;
        }

        showToast('Authority Park লোগো সফলভাবে ব্যাকগ্রাউন্ড রিমুভ করে যুক্ত করা হয়েছে! ✨');
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Logo process error:', err);
      showToast('লোগো লোড করতে সমস্যা হয়েছে।');
    }
  });

  // Work Calendar Modal Controls
  const mainMenuCalendarBtn = document.getElementById('main-menu-calendar-btn');
  const sidebarCalendarBtn = document.getElementById('sidebar-calendar-btn');
  const closeCalendarBtn = document.getElementById('close-calendar-modal-btn');
  const closeCalendarX = document.getElementById('close-calendar-modal-x');
  const workCalendarModal = document.getElementById('work-calendar-modal');
  const calendarPrevBtn = document.getElementById('calendar-prev-month-btn');
  const calendarNextBtn = document.getElementById('calendar-next-month-btn');
  const calendarTodayBtn = document.getElementById('calendar-today-btn');
  const calendarMemberFilterSelect = document.getElementById('calendar-member-filter') as HTMLSelectElement | null;

  mainMenuCalendarBtn?.addEventListener('click', openWorkCalendarModal);
  sidebarCalendarBtn?.addEventListener('click', openWorkCalendarModal);
  closeCalendarBtn?.addEventListener('click', closeWorkCalendarModal);
  closeCalendarX?.addEventListener('click', closeWorkCalendarModal);
  workCalendarModal?.addEventListener('click', (e) => {
    if (e.target === workCalendarModal) closeWorkCalendarModal();
  });

  calendarPrevBtn?.addEventListener('click', () => {
    calendarActiveMonth.setMonth(calendarActiveMonth.getMonth() - 1);
    calendarActiveMonth = new Date(calendarActiveMonth.getTime());
    renderWorkCalendar();
  });

  calendarNextBtn?.addEventListener('click', () => {
    calendarActiveMonth.setMonth(calendarActiveMonth.getMonth() + 1);
    calendarActiveMonth = new Date(calendarActiveMonth.getTime());
    renderWorkCalendar();
  });

  calendarTodayBtn?.addEventListener('click', () => {
    calendarActiveMonth = new Date();
    calendarSelectedDayStr = new Date().toISOString().split('T')[0];
    renderWorkCalendar();
  });

  calendarMemberFilterSelect?.addEventListener('change', (e) => {
    calendarMemberFilter = (e.target as HTMLSelectElement).value;
    renderWorkCalendar();
  });

  // Task Records Modal Controls
  const mainMenuRecordsBtn = document.getElementById('main-menu-records-btn');
  const sidebarRecordsBtn = document.getElementById('sidebar-records-btn');
  const headerUserBadge = document.getElementById('header-user-badge');
  const closeRecordsBtn = document.getElementById('close-records-modal-btn');
  const closeRecordsX = document.getElementById('close-records-modal-x');
  const taskRecordsModal = document.getElementById('task-records-modal');
  const recordsMemberSelect = document.getElementById('records-member-select') as HTMLSelectElement | null;
  const tabRecordsMissed = document.getElementById('tab-records-missed');
  const tabRecordsCompleted = document.getElementById('tab-records-completed');

  mainMenuRecordsBtn?.addEventListener('click', () => openTaskRecordsModal());
  sidebarRecordsBtn?.addEventListener('click', () => openTaskRecordsModal());
  headerUserBadge?.addEventListener('click', () => openTaskRecordsModal(currentUser.name));
  closeRecordsBtn?.addEventListener('click', closeTaskRecordsModal);
  closeRecordsX?.addEventListener('click', closeTaskRecordsModal);
  taskRecordsModal?.addEventListener('click', (e) => {
    if (e.target === taskRecordsModal) closeTaskRecordsModal();
  });

  recordsMemberSelect?.addEventListener('change', (e) => {
    const selected = (e.target as HTMLSelectElement).value;
    renderTaskRecordsModal(selected);
  });

  tabRecordsMissed?.addEventListener('click', () => {
    recordsActiveTab = 'missed';
    renderTaskRecordsModal();
  });

  tabRecordsCompleted?.addEventListener('click', () => {
    recordsActiveTab = 'completed';
    renderTaskRecordsModal();
  });

  // Workspace Data View Switcher (My Tasks vs All Team Tasks)
  const viewMyTasksTab = document.getElementById('view-my-tasks-tab');
  const viewAllTasksTab = document.getElementById('view-all-tasks-tab');

  viewMyTasksTab?.addEventListener('click', () => {
    currentFilterAssignee = 'my-tasks';
    updateWorkspaceTabsUI();
    renderTaskList();
  });

  viewAllTasksTab?.addEventListener('click', () => {
    currentFilterAssignee = 'all';
    updateWorkspaceTabsUI();
    renderTaskList();
  });

  // Monthly Time Zone Controls
  const monthlyMemberSelect = document.getElementById('monthly-zone-member-select') as HTMLSelectElement | null;
  const monthlyCalendarBtn = document.getElementById('monthly-zone-calendar-btn');
  const monthlyRefreshBtn = document.getElementById('monthly-zone-refresh-btn');

  monthlyMemberSelect?.addEventListener('change', (e) => {
    monthlyZoneSelectedMember = (e.target as HTMLSelectElement).value;
    updateMonthlyZoneUI();
  });

  monthlyCalendarBtn?.addEventListener('click', openWorkCalendarModal);
  monthlyRefreshBtn?.addEventListener('click', () => {
    updateMonthlyZoneUI();
    showToast('মাসিক কাজের সময় রিফ্রেশ করা হয়েছে।');
  });

  // Global Keydown
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEditModal();
      closeShareModal();
      closeUserTeamModal();
      closeWorkCalendarModal();
      closeTaskRecordsModal();
      restrictedModal?.classList.add('hidden');
      inviteAcceptModal?.classList.add('hidden');
    }
  });
}

// Window helper for quick filter reset
(window as any).resetAllFilters = () => {
  currentFilterStatus = 'all';
  currentFilterPriority = 'all';
  currentFilterAssignee = 'all';
  searchQuery = '';
  const searchInput = document.getElementById('task-search-input') as HTMLInputElement | null;
  if (searchInput) searchInput.value = '';
  renderSidebarAssigneeFilters();
  renderTaskList();
};

// --- Firestore Real-Time Subscriptions ---
function subscribeToFirestoreUpdates(): void {
  // Test Firestore connection first per skill rules
  testFirestoreConnection().then((connected) => {
    updateSyncStatusBadge(connected);
  });

  // Subscribe to Tasks
  try {
    onSnapshot(collection(db, 'tasks'), (snapshot) => {
      const remoteTasks: Task[] = [];
      snapshot.forEach((d) => {
        const data = d.data() as Task;
        remoteTasks.push(data);
      });

      if (remoteTasks.length > 0) {
        tasks = remoteTasks;
        saveTasksToStorage(tasks);
        updateDailyOverview();
        renderTaskList();
        updateSyncStatusBadge(true);
      }
    }, (error) => {
      console.warn('Firestore tasks snapshot subscription error:', error);
      updateSyncStatusBadge(false);
    });
  } catch (err) {
    console.warn('Could not initialize tasks listener:', err);
  }

  // Subscribe to Team Members
  try {
    onSnapshot(collection(db, 'teamMembers'), (snapshot) => {
      const remoteMembers: TeamMember[] = [];
      snapshot.forEach((d) => {
        remoteMembers.push(d.data() as TeamMember);
      });

      if (remoteMembers.length > 0) {
        teamMembers = remoteMembers;
        saveTeamMembers(teamMembers);

        // Sync active user if matching member exists
        const matched = teamMembers.find(
          (m) => m.id === currentUser.id || m.email?.toLowerCase() === currentUser.email?.toLowerCase()
        );
        if (matched) {
          currentUser = matched;
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(matched));
          updateCurrentUserHeaderBadge();
        }

        renderTeamMemberListInModal();
        renderAssigneeSelectOptions();
        renderSidebarAssigneeFilters();
        renderTaskList();
      } else {
        // Seed default team members if collection is empty
        DEFAULT_TEAM_MEMBERS.forEach((m) => {
          setDoc(doc(db, 'teamMembers', m.id), m).catch(console.error);
        });
      }
    }, (err) => {
      console.warn('Firestore teamMembers snapshot subscription error:', err);
    });
  } catch (err) {
    console.warn('Could not initialize teamMembers listener:', err);
  }

  // Subscribe to Team Invitations
  try {
    onSnapshot(collection(db, 'teamInvitations'), (snapshot) => {
      const remoteInvites: TeamInvitation[] = [];
      snapshot.forEach((d) => {
        remoteInvites.push(d.data() as TeamInvitation);
      });
      pendingInvitations = remoteInvites;
      renderPendingInvitationsList();
    }, (err) => {
      console.warn('Firestore teamInvitations snapshot error:', err);
    });
  } catch (err) {
    console.warn('Could not initialize teamInvitations listener:', err);
  }

  // Auth State Listener
  try {
    onAuthStateChanged(auth, (user) => {
      if (user && user.email) {
        const userEmailLower = user.email.toLowerCase();
        const isMaster = userEmailLower === OWNER_ADMIN_EMAIL.toLowerCase();

        const pendingInvite = pendingInvitations.find((i) => i.email?.toLowerCase() === userEmailLower && i.status === 'pending');
        let role: 'admin' | 'member' = 'member';

        if (isMaster) {
          role = 'admin';
        } else if (pendingInvite) {
          role = pendingInvite.role;
          updateDoc(doc(db, 'teamInvitations', pendingInvite.id), {
            status: 'accepted',
            acceptedAt: Date.now(),
            acceptedByUid: user.uid,
          }).catch(console.warn);
        } else {
          const existing = teamMembers.find((m) => m.email?.toLowerCase() === userEmailLower);
          if (existing) {
            role = existing.role;
          }
        }

        const verifiedUser: TeamMember = {
          id: `user_${user.uid}`,
          name: isMaster ? 'Rokon Khan (Admin)' : (user.displayName || user.email.split('@')[0]),
          email: user.email,
          role: role,
          avatarColor: role === 'admin' ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600',
        };

        const existingIdx = teamMembers.findIndex((m) => m.email?.toLowerCase() === userEmailLower);
        if (existingIdx >= 0) {
          teamMembers[existingIdx] = verifiedUser;
        } else {
          teamMembers.push(verifiedUser);
        }
        saveTeamMembers(teamMembers);
        saveCurrentUser(verifiedUser);
        setDoc(doc(db, 'teamMembers', verifiedUser.id), verifiedUser, { merge: true }).catch(console.warn);
      } else {
        currentUser = GUEST_USER;
        updateCurrentUserHeaderBadge();
        renderTeamMemberListInModal();
      }
    });
  } catch (err) {
    console.warn('Auth state error:', err);
  }
}

// --- Logo Management & Transparent Background Processing ---
const LOGO_STORAGE_KEY = 'authority_park_custom_logo';

export function initializeBrandLogo(): void {
  const savedLogo = localStorage.getItem(LOGO_STORAGE_KEY);
  const logoImg = document.getElementById('authority-park-logo-img') as HTMLImageElement | null;

  if (savedLogo && logoImg) {
    logoImg.src = savedLogo;
  }
}

/**
 * Strips white, light, or uniform background from an image using an off-screen HTML5 Canvas
 * to produce a clean, crisp transparent PNG.
 */
export function processImageRemoveBackground(imageSrc: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(imageSrc);
        return;
      }

      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;

      // Sample corners to detect background color
      const corners = [
        0,
        (canvas.width - 1) * 4,
        ((canvas.height - 1) * canvas.width) * 4,
        ((canvas.height - 1) * canvas.width + canvas.width - 1) * 4,
      ];

      let bgR = 255, bgG = 255, bgB = 255;
      for (const idx of corners) {
        if (data[idx + 3] > 100) {
          bgR = data[idx];
          bgG = data[idx + 1];
          bgB = data[idx + 2];
          break;
        }
      }

      // If background is white or similar to sample corner, make it transparent
      const threshold = 40;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
        if (dist < threshold || (r > 238 && g > 238 && b > 238)) {
          data[i + 3] = 0; // Transparent
        }
      }

      ctx.putImageData(imgData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(imageSrc);
    img.src = imageSrc;
  });
}

// --- App Initialization ---
export function initializeApp(): void {
  initializeBrandLogo();
  teamMembers = loadTeamMembers();
  currentUser = loadCurrentUser();
  tasks = loadTasksFromStorage();

  // Set current date in header
  const dateDisplay = document.getElementById('current-date-display');
  if (dateDisplay) {
    const today = new Date();
    const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    dateDisplay.textContent = today.toLocaleDateString('en-US', options);
  }

  updateCurrentUserHeaderBadge();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  updateDailyOverview();
  renderTaskList();
  setupEventListeners();
  startGlobalTimerTicker();
  startLiveClockTicker();
  cleanupExpiredCompletedTasks();

  // Check if opened with an invitation link (?invite=...)
  checkUrlInvitationParam();

  // Connect to Firestore real-time synchronization
  subscribeToFirestoreUpdates();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
