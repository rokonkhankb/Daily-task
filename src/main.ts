/**
 * Daily Work Tracker - Team Workspace Edition
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
  estimatedMinutes?: number;
  timeSpentSeconds: number;
  isTimerRunning?: boolean;
  timerStartedAt?: number | null;
  assigneeName?: string;
  assigneeEmail?: string;
  assigneeId?: string;
  createdBy?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  avatarColor?: string;
}

export const ADMIN_EMAIL = 'rokonkhankb12@gmail.com';

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
let currentUser: TeamMember = DEFAULT_TEAM_MEMBERS[0]; // Defaults to Rokon Khan (Admin)

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
  return currentUser.role === 'admin';
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
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.name) return parsed;
    }
  } catch (e) {}
  return DEFAULT_TEAM_MEMBERS[0];
}

function saveCurrentUser(user: TeamMember): void {
  currentUser = user;
  try {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } catch (e) {}
  updateCurrentUserHeaderBadge();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  renderTaskList();
}

// --- Header User Badge ---
function updateCurrentUserHeaderBadge(): void {
  const nameDisplay = document.getElementById('user-name-display');
  const avatarBadge = document.getElementById('user-avatar-badge');
  const adminPill = document.getElementById('user-admin-pill');

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
    result = result.filter((t) => t.assigneeName === currentUser.name);
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

      // Stopwatch Timer Button
      let timerBtnHtml = '';
      if (isTimerRunning) {
        timerBtnHtml = `
          <button
            type="button"
            data-action="toggle-timer"
            data-id="${task.id}"
            class="task-timer-btn inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 border border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.3)] transition-all cursor-pointer"
            title="Pause timer (currently tracking)"
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
              currentSecs > 0
                ? 'bg-white/5 text-slate-200 hover:bg-white/10 hover:text-white border border-white/15 shadow-inner'
                : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200 border border-white/10'
            } transition-all cursor-pointer"
            title="Start timer for this task"
          >
            <svg class="w-3 h-3 text-slate-400" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5 3 19 12 5 21"/>
            </svg>
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

  let estimatedMinutes = 0;
  if (estimatedInput && estimatedInput.value.trim() !== '') {
    estimatedMinutes = Math.max(0, parseInt(estimatedInput.value, 10) || 0);
  }

  const assigneeName = assigneeSelect?.value || '';
  const assignedMember = teamMembers.find((m) => m.name === assigneeName);

  const newTask: Task = {
    id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title,
    priority,
    status,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    estimatedMinutes,
    timeSpentSeconds: 0,
    isTimerRunning: false,
    timerStartedAt: null,
    assigneeName: assigneeName || undefined,
    assigneeEmail: assignedMember?.email,
    assigneeId: assignedMember?.id,
    createdBy: currentUser.name,
  };

  // Optimistic UI update
  tasks.unshift(newTask);
  saveTasksToStorage(tasks);

  titleInput.value = '';
  if (estimatedInput) estimatedInput.value = '';
  titleInput.focus();

  updateDailyOverview();
  renderTaskList();
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
  if (newStatus === 'Done' && task.isTimerRunning) {
    if (task.timerStartedAt) {
      const elapsed = Math.floor((now - task.timerStartedAt) / 1000);
      task.timeSpentSeconds = Math.max(0, (task.timeSpentSeconds || 0) + elapsed);
    }
    task.isTimerRunning = false;
    task.timerStartedAt = null;
  }

  task.status = newStatus;
  task.updatedAt = now;
  saveTasksToStorage(tasks);

  updateDailyOverview();
  renderTaskList();
  showToast(`Status updated to "${newStatus}"`);

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      status: task.status,
      updatedAt: task.updatedAt,
      timeSpentSeconds: task.timeSpentSeconds,
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

  const now = Date.now();
  if (task.isTimerRunning) {
    if (task.timerStartedAt) {
      const elapsed = Math.floor((now - task.timerStartedAt) / 1000);
      task.timeSpentSeconds = Math.max(0, (task.timeSpentSeconds || 0) + elapsed);
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
  renderTaskList();

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', taskId), {
      isTimerRunning: task.isTimerRunning,
      timerStartedAt: task.timerStartedAt,
      timeSpentSeconds: task.timeSpentSeconds,
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

  if (idInput) idInput.value = task.id;
  if (titleInput) titleInput.value = task.title;
  if (prioritySelect) prioritySelect.value = task.priority;
  if (statusSelect) statusSelect.value = task.status;

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

  const updatedTitle = titleInput?.value.trim();
  if (!updatedTitle) {
    showToast('Task description cannot be empty');
    return;
  }

  task.title = updatedTitle;
  task.priority = (prioritySelect?.value || 'Medium') as PriorityLevel;
  task.status = (statusSelect?.value || 'To Do') as TaskStatus;

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
  closeEditModal();
  showToast('Task updated successfully');

  // Sync to Firestore
  try {
    await updateDoc(doc(db, 'tasks', task.id), {
      title: task.title,
      priority: task.priority,
      status: task.status,
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

  if (teamMembers.length === 0) {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-white/5 text-center text-xs text-slate-400">
        টিমে কোনো মেম্বার পাওয়া যায়নি। নিচে নতুন মেম্বার যোগ করুন।
      </div>
    `;
    return;
  }

  container.innerHTML = teamMembers
    .map((member) => {
      const isSelected = currentUser.id === member.id || currentUser.email?.toLowerCase() === member.email?.toLowerCase();
      const isAdmin = member.role === 'admin';

      return `
        <div class="flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl ${
          isSelected
            ? 'bg-sky-500/15 border border-sky-400/40 shadow-[0_0_12px_rgba(56,189,248,0.15)]'
            : 'bg-white/[0.04] border border-white/10 hover:border-white/20'
        } gap-2.5 transition-all">
          <div class="flex items-center gap-3 min-w-0">
            <span class="w-8 h-8 rounded-full bg-gradient-to-br ${
              member.avatarColor || (isAdmin ? 'from-amber-400 to-rose-500' : 'from-sky-400 to-blue-600')
            } text-slate-950 text-xs font-bold flex items-center justify-center shrink-0 shadow-xs">
              ${member.name.trim().charAt(0).toUpperCase()}
            </span>
            <div class="min-w-0">
              <div class="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                <span class="truncate">${escapeHtml(member.name)}</span>
                ${
                  isAdmin
                    ? '<span class="px-2 py-0.5 rounded-md bg-amber-400/20 text-amber-300 text-[10px] font-bold border border-amber-400/30 flex items-center gap-1">👑 Admin</span>'
                    : '<span class="px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 text-[10px] font-medium border border-white/10">👤 Member</span>'
                }
                ${
                  isSelected
                    ? '<span class="px-1.5 py-0.5 rounded bg-sky-400/20 text-sky-300 text-[9px] font-bold border border-sky-400/30">Active (You)</span>'
                    : ''
                }
              </div>
              <div class="text-[11px] text-slate-400 truncate">${escapeHtml(member.email)}</div>
            </div>
          </div>

          <div class="flex items-center gap-1.5 shrink-0 self-end sm:self-center flex-wrap">
            <!-- Toggle Admin / Member Role Button -->
            <button
              type="button"
              data-action="toggle-admin"
              data-member-id="${member.id}"
              class="px-2.5 py-1 text-[11px] font-semibold rounded-lg ${
                isAdmin
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
              } transition-all cursor-pointer flex items-center gap-1"
              title="${isAdmin ? 'Change role to Member' : 'Promote this member to Admin'}"
            >
              ${isAdmin ? 'Demote to Member' : '👑 Make Admin'}
            </button>

            <!-- Switch Active User Button -->
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

            <!-- Remove Member Button -->
            <button
              type="button"
              data-action="remove-member"
              data-member-id="${member.id}"
              class="p-1.5 text-[11px] font-semibold rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/20 hover:border-rose-500/40 transition-all cursor-pointer"
              title="Remove this member from team"
              aria-label="Remove member"
            >
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  // Bind Actions: Toggle Admin, Switch User, Remove Member
  container.querySelectorAll('[data-action="toggle-admin"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      if (memberId) handleToggleMemberRole(memberId);
    });
  });

  container.querySelectorAll('[data-action="switch-user"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      const target = teamMembers.find((m) => m.id === memberId);
      if (target) {
        saveCurrentUser(target);
        renderTeamMemberListInModal();
        showToast(`Active profile switched to "${target.name}"`);
      }
    });
  });

  container.querySelectorAll('[data-action="remove-member"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const memberId = btn.getAttribute('data-member-id');
      if (memberId) handleRemoveTeamMember(memberId);
    });
  });
}

export async function handleToggleMemberRole(memberId: string): Promise<void> {
  const member = teamMembers.find((m) => m.id === memberId);
  if (!member) return;

  const currentRole = member.role;
  const newRole: 'admin' | 'member' = currentRole === 'admin' ? 'member' : 'admin';

  // Safeguard: warn if demoting the only admin
  if (newRole === 'member') {
    const adminCount = teamMembers.filter((m) => m.role === 'admin').length;
    if (adminCount <= 1 && member.role === 'admin') {
      const proceed = window.confirm(
        `"${member.name}" is currently the only Admin. Are you sure you want to demote them to Member? (At least one Admin is recommended to manage task deletions).`
      );
      if (!proceed) return;
    }
  }

  member.role = newRole;
  if (newRole === 'admin') {
    member.avatarColor = 'from-amber-400 to-rose-500';
  }

  // If this member is the current active user, update currentUser as well
  if (currentUser.id === member.id || currentUser.email.toLowerCase() === member.email.toLowerCase()) {
    currentUser.role = newRole;
    saveCurrentUser(currentUser);
  }

  saveTeamMembers(teamMembers);
  renderTeamMemberListInModal();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  updateCurrentUserHeaderBadge();
  renderTaskList();

  showToast(`Role updated: "${member.name}" is now ${newRole === 'admin' ? 'an Admin 👑' : 'a Team Member 👤'}`);

  // Sync role update to Firestore
  try {
    await setDoc(doc(db, 'teamMembers', member.id), member, { merge: true });
  } catch (err) {
    console.warn('Firestore member role update error:', err);
  }
}

export async function handleRemoveTeamMember(memberId: string): Promise<void> {
  const member = teamMembers.find((m) => m.id === memberId);
  if (!member) return;

  if (teamMembers.length <= 1) {
    showToast('Cannot remove the last member of the workspace.');
    return;
  }

  const confirmRemove = window.confirm(
    `Are you sure you want to remove "${member.name}" (${member.role === 'admin' ? 'Admin' : 'Member'}) from the team?`
  );
  if (!confirmRemove) return;

  // Remove from local list
  teamMembers = teamMembers.filter((m) => m.id !== memberId);
  saveTeamMembers(teamMembers);

  // If the removed user was the active user, switch to another admin or first available member
  if (currentUser.id === memberId || currentUser.email.toLowerCase() === member.email.toLowerCase()) {
    const nextUser = teamMembers.find((m) => m.role === 'admin') || teamMembers[0];
    if (nextUser) {
      saveCurrentUser(nextUser);
      showToast(`Switched active profile to "${nextUser.name}"`);
    }
  }

  renderTeamMemberListInModal();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  updateCurrentUserHeaderBadge();
  renderTaskList();

  showToast(`Removed "${member.name}" from workspace`);

  // Delete from Firestore
  try {
    await deleteDoc(doc(db, 'teamMembers', memberId));
  } catch (err) {
    console.warn('Firestore member delete error:', err);
  }
}

export async function handleAddNewTeamMember(e?: Event): Promise<void> {
  if (e) e.preventDefault();
  const nameInput = document.getElementById('new-member-name') as HTMLInputElement | null;
  const emailInput = document.getElementById('new-member-email') as HTMLInputElement | null;
  const roleSelect = document.getElementById('new-member-role') as HTMLSelectElement | null;

  const name = nameInput?.value.trim();
  const email = emailInput?.value.trim().toLowerCase() || `${name?.toLowerCase().replace(/\s+/g, '')}@team.com`;
  const role = (roleSelect?.value === 'admin' ? 'admin' : 'member') as 'admin' | 'member';

  if (!name) {
    showToast('Please enter member name');
    return;
  }

  const colorOptions = [
    'from-sky-400 to-blue-600',
    'from-emerald-400 to-teal-600',
    'from-violet-400 to-purple-600',
    'from-cyan-400 to-indigo-600',
    'from-fuchsia-400 to-pink-600',
  ];
  const avatarColor = role === 'admin'
    ? 'from-amber-400 to-rose-500'
    : colorOptions[teamMembers.length % colorOptions.length];

  const newMember: TeamMember = {
    id: `member_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name,
    email,
    role,
    avatarColor,
  };

  teamMembers.push(newMember);
  saveTeamMembers(teamMembers);

  if (nameInput) nameInput.value = '';
  if (emailInput) emailInput.value = '';
  if (roleSelect) roleSelect.value = 'member';

  renderTeamMemberListInModal();
  renderAssigneeSelectOptions();
  renderSidebarAssigneeFilters();
  showToast(`Added "${name}" as ${role === 'admin' ? 'Admin 👑' : 'Member 👤'}`);

  // Sync member to Firestore
  try {
    await setDoc(doc(db, 'teamMembers', newMember.id), newMember);
  } catch (err) {
    console.warn('Firestore member save error:', err);
  }
}

export async function handleGoogleSignIn(): Promise<void> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    if (user && user.email) {
      const existing = teamMembers.find((m) => m.email.toLowerCase() === user.email?.toLowerCase());
      if (existing) {
        saveCurrentUser(existing);
      } else {
        const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        const newMember: TeamMember = {
          id: `user_${user.uid}`,
          name: user.displayName || user.email.split('@')[0],
          email: user.email,
          role: isAdmin ? 'admin' : 'member',
          avatarColor: 'from-amber-400 to-rose-500',
        };
        teamMembers.push(newMember);
        saveTeamMembers(teamMembers);
        saveCurrentUser(newMember);
        setDoc(doc(db, 'teamMembers', newMember.id), newMember).catch(console.error);
      }
      closeUserTeamModal();
      showToast(`Signed in as ${user.displayName || user.email}`);
    }
  } catch (err) {
    console.error('Google Sign In Error:', err);
    showToast('Google sign in error or popup closed.');
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
  const newMemberForm = document.getElementById('new-member-form');
  const googleSignInBtn = document.getElementById('google-signin-btn');
  const manageTeamSidebarBtn = document.getElementById('manage-team-sidebar-btn');

  userProfileBtn?.addEventListener('click', openUserTeamModal);
  manageTeamSidebarBtn?.addEventListener('click', openUserTeamModal);
  closeUserTeamBtn?.addEventListener('click', closeUserTeamModal);
  userTeamModal?.addEventListener('click', (e) => {
    if (e.target === userTeamModal) closeUserTeamModal();
  });
  newMemberForm?.addEventListener('submit', handleAddNewTeamMember);
  googleSignInBtn?.addEventListener('click', handleGoogleSignIn);

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

  // Global Keydown
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeEditModal();
      closeShareModal();
      closeUserTeamModal();
      restrictedModal?.classList.add('hidden');
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

  // Auth State Listener
  try {
    onAuthStateChanged(auth, (user) => {
      if (user && user.email) {
        const matched = teamMembers.find((m) => m.email.toLowerCase() === user.email?.toLowerCase());
        if (matched) {
          saveCurrentUser(matched);
        } else {
          const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
          const newMember: TeamMember = {
            id: `user_${user.uid}`,
            name: user.displayName || user.email.split('@')[0],
            email: user.email,
            role: isAdmin ? 'admin' : 'member',
          };
          saveCurrentUser(newMember);
        }
      }
    });
  } catch (err) {
    console.warn('Auth state error:', err);
  }
}

// --- App Initialization ---
export function initializeApp(): void {
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

  // Connect to Firestore real-time synchronization
  subscribeToFirestoreUpdates();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
