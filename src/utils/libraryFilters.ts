import { PresetFormatMode, WorkoutPreset } from '../types/workout';
import { resolveMobilityDurationSeconds } from './calculations';

export const SAVED_LIBRARY_FILTERS_KEY = 'wt_saved_library_filters';

export type StructureFilterId =
  | 'standard'
  | 'circuit'
  | 'emom_rotating'
  | 'emom_complex'
  | 'amrap'
  | 'no_rest';

export type ExerciseRowTypeFilterId = 'strength' | 'mobility' | 'cardio';

export type LoadStyleFilterId =
  | 'bodyweight'
  | 'single_kb_db'
  | 'double_kg'
  | 'barbell_plate'
  | 'band_assisted';

export type MetricLateralityFilterId =
  | 'reps'
  | 'time'
  | 'distance'
  | 'unilateral'
  | 'rep_scheme';

export type DurationFilterId = 'any' | 'le5' | 'le10' | '15_30' | 'gt30' | 'none';

export type LibrarySortOption =
  | 'title_asc'
  | 'duration_asc'
  | 'duration_desc'
  | 'exercises_desc'
  | 'updated_desc';

export interface LibraryFilterState {
  searchQuery: string;
  categories: string[];
  programIds: string[]; // may include '__unassigned__'
  tags: string[];
  tagMatchMode: 'any' | 'all';
  structureModes: StructureFilterId[];
  exerciseTypes: ExerciseRowTypeFilterId[];
  loadStyles: LoadStyleFilterId[];
  metricLaterality: MetricLateralityFilterId[];
  duration: DurationFilterId;
  biteSizeOnly: boolean;
  hasVideoOnly: boolean;
  hasCuesOnly: boolean;
  exerciseCueQuery: string;
  sortBy: LibrarySortOption;
}

export interface SavedLibraryFilterView {
  id: string;
  name: string;
  filters: LibraryFilterState;
  createdAt: string;
}

export const DEFAULT_LIBRARY_FILTER_STATE: LibraryFilterState = {
  searchQuery: '',
  categories: [],
  programIds: [],
  tags: [],
  tagMatchMode: 'any',
  structureModes: [],
  exerciseTypes: [],
  loadStyles: [],
  metricLaterality: [],
  duration: 'any',
  biteSizeOnly: false,
  hasVideoOnly: false,
  hasCuesOnly: false,
  exerciseCueQuery: '',
  sortBy: 'title_asc',
};

export function loadSavedLibraryFilters(): SavedLibraryFilterView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(SAVED_LIBRARY_FILTERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      .map((item) => ({
        id: item.id,
        name: item.name,
        createdAt: item.createdAt || new Date().toISOString(),
        filters: {
          ...DEFAULT_LIBRARY_FILTER_STATE,
          ...(item.filters || {}),
        },
      }));
  } catch {
    return [];
  }
}

export function persistSavedLibraryFilters(views: SavedLibraryFilterView[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SAVED_LIBRARY_FILTERS_KEY, JSON.stringify(views));
  } catch {
    // Ignore storage quota / privacy restrictions
  }
}

export function countActiveLibraryFilters(f: LibraryFilterState): number {
  let count = 0;
  if (f.categories.length > 0) count += 1;
  if (f.programIds.length > 0) count += 1;
  if (f.tags.length > 0) count += 1;
  if (f.structureModes.length > 0) count += 1;
  if (f.exerciseTypes.length > 0) count += 1;
  if (f.loadStyles.length > 0) count += 1;
  if (f.metricLaterality.length > 0) count += 1;
  if (f.duration !== 'any') count += 1;
  if (f.biteSizeOnly) count += 1;
  if (f.hasVideoOnly) count += 1;
  if (f.hasCuesOnly) count += 1;
  if (f.exerciseCueQuery.trim().length > 0) count += 1;
  return count;
}

export function hasAnyActiveFilterOrSort(f: LibraryFilterState): boolean {
  return (
    countActiveLibraryFilters(f) > 0 ||
    f.searchQuery.trim().length > 0 ||
    f.sortBy !== 'title_asc'
  );
}

export function resolvePresetEffectiveFormat(preset: WorkoutPreset): PresetFormatMode {
  if (preset.formatMode) return preset.formatMode;
  if (preset.defaultTimer?.mode === 'circuit') {
    return preset.defaultTimer.restSec === 0 ? 'emom_complex' : 'circuit';
  }
  return 'standard';
}

function matchesStructureMode(preset: WorkoutPreset, mode: StructureFilterId): boolean {
  const effectiveFormat = resolvePresetEffectiveFormat(preset);
  if (mode === 'standard') return effectiveFormat === 'standard';
  if (mode === 'circuit') return effectiveFormat === 'circuit';
  if (mode === 'emom_rotating') {
    return effectiveFormat === 'emom_complex' && preset.defaultTimer?.emomMode === 'rotating';
  }
  if (mode === 'emom_complex') {
    return effectiveFormat === 'emom_complex' && preset.defaultTimer?.emomMode !== 'rotating';
  }
  if (mode === 'amrap') {
    return effectiveFormat === 'amrap';
  }
  if (mode === 'no_rest') {
    return (preset.defaultTimer?.restSec ?? 60) === 0;
  }
  return false;
}

function matchesLoadStyle(preset: WorkoutPreset, style: LoadStyleFilterId): boolean {
  const presetTagsLower = (preset.tags || []).map((t) => t.toLowerCase());
  return (preset.exercises || []).some((ex) => {
    const text = `${ex.exerciseName || ''} ${ex.baseNotes || ''} ${ex.category || ''}`.toLowerCase();
    if (style === 'bodyweight') {
      return ex.loadType === 'bodyweight' || ex.loadType === 'bw_plus_kg';
    }
    if (style === 'single_kb_db') {
      return ex.loadType === 'single_kg' || ex.loadType === 'offset_kg';
    }
    if (style === 'double_kg') {
      return ex.loadType === 'double_kg';
    }
    if (style === 'barbell_plate') {
      return (
        ex.loadType === 'ruck_kg' ||
        /\b(barbell|plate|trap bar|ruck|deadlift bar|bb)\b/.test(text) ||
        presetTagsLower.some((t) => /barbell|plate|ruck/.test(t))
      );
    }
    if (style === 'band_assisted') {
      return (
        /\b(band|banded|assisted|strap|trx|ring|mini-band|resistance band)\b/.test(text) ||
        presetTagsLower.some((t) => /band|assisted|rehab|physio/.test(t))
      );
    }
    return false;
  });
}

function matchesMetricOrLaterality(
  preset: WorkoutPreset,
  criterion: MetricLateralityFilterId
): boolean {
  return (preset.exercises || []).some((ex) => {
    if (criterion === 'reps') {
      return (
        ex.trackingType !== 'cardio' &&
        ex.trackingType !== 'mobility' &&
        (ex.metricType || 'reps') === 'reps'
      );
    }
    if (criterion === 'time') {
      return (
        ex.metricType === 'time' ||
        (ex.trackingType === 'mobility' && resolveMobilityDurationSeconds(ex) > 0)
      );
    }
    if (criterion === 'distance') {
      return ex.metricType === 'distance' || ex.trackingType === 'cardio';
    }
    if (criterion === 'unilateral') {
      return Boolean(ex.side) || Boolean(ex.isPerSide);
    }
    if (criterion === 'rep_scheme') {
      return Boolean(ex.repScheme && ex.repScheme.schemeType !== 'fixed');
    }
    return false;
  });
}

export function matchesLibraryFilters(preset: WorkoutPreset, f: LibraryFilterState): boolean {
  // 0. Main search bar
  if (f.searchQuery.trim()) {
    const q = f.searchQuery.trim().toLowerCase();
    const matchTitle = (preset.title || '').toLowerCase().includes(q);
    const matchLegacyId = (preset.legacyWorkoutId || '').toLowerCase().includes(q);
    const matchType = (preset.workoutType || '').toLowerCase().includes(q);
    const matchTag = (preset.tags || []).some((t) => t.toLowerCase().includes(q));
    const matchNotes = (preset.workoutNotes || '').toLowerCase().includes(q);
    const matchEx = (preset.exercises || []).some(
      (e) =>
        (e.exerciseName || '').toLowerCase().includes(q) ||
        (e.baseNotes || '').toLowerCase().includes(q)
    );
    if (!matchTitle && !matchLegacyId && !matchType && !matchTag && !matchNotes && !matchEx) {
      return false;
    }
  }

  // 1. Categories (OR within group)
  if (f.categories.length > 0) {
    const normCat = (preset.workoutType || '').toLowerCase();
    if (!f.categories.some((c) => c.toLowerCase() === normCat)) {
      return false;
    }
  }

  // 2. Programs (OR within group, supporting '__unassigned__')
  if (f.programIds.length > 0) {
    const progIds = preset.programIds || [];
    const matchesProg = f.programIds.some((pid) =>
      pid === '__unassigned__' ? progIds.length === 0 : progIds.includes(pid)
    );
    if (!matchesProg) return false;
  }

  // 3. Tags (Any OR vs All AND)
  if (f.tags.length > 0) {
    const presetTagsLower = new Set((preset.tags || []).map((t) => t.toLowerCase()));
    const matchesTags =
      f.tagMatchMode === 'all'
        ? f.tags.every((t) => presetTagsLower.has(t.toLowerCase()))
        : f.tags.some((t) => presetTagsLower.has(t.toLowerCase()));
    if (!matchesTags) return false;
  }

  // 4. Structure & Timer Mode (OR within group)
  if (f.structureModes.length > 0) {
    if (!f.structureModes.some((m) => matchesStructureMode(preset, m))) {
      return false;
    }
  }

  // 5. Exercise Format / Row Type (OR within group)
  if (f.exerciseTypes.length > 0) {
    const matchesExType = f.exerciseTypes.some((et) =>
      (preset.exercises || []).some((ex) => {
        if (et === 'strength') {
          return ex.trackingType === 'strength' || ex.trackingType === 'circuit';
        }
        return ex.trackingType === et;
      })
    );
    if (!matchesExType) return false;
  }

  // 6. Load Style (OR within group)
  if (f.loadStyles.length > 0) {
    if (!f.loadStyles.some((ls) => matchesLoadStyle(preset, ls))) {
      return false;
    }
  }

  // 7. Tracking Metric & Laterality (OR within group)
  if (f.metricLaterality.length > 0) {
    if (!f.metricLaterality.some((ml) => matchesMetricOrLaterality(preset, ml))) {
      return false;
    }
  }

  // 8. Target Duration
  if (f.duration !== 'any') {
    const dur = preset.durationMinutes;
    if (f.duration === 'le5') {
      if (!(typeof dur === 'number' && dur > 0 && dur <= 5)) return false;
    } else if (f.duration === 'le10') {
      if (!(preset.isBiteSize === true || (typeof dur === 'number' && dur > 0 && dur <= 10))) {
        return false;
      }
    } else if (f.duration === '15_30') {
      if (!(typeof dur === 'number' && dur >= 15 && dur <= 30)) return false;
    } else if (f.duration === 'gt30') {
      if (!(typeof dur === 'number' && dur > 30)) return false;
    } else if (f.duration === 'none') {
      if (typeof dur === 'number' && dur > 0) return false;
    }
  }

  // 9. Attributes & Media
  if (f.biteSizeOnly && preset.isBiteSize !== true) return false;
  if (f.hasVideoOnly && !preset.videoUrl?.trim()) return false;
  if (f.hasCuesOnly) {
    const hasNotes =
      Boolean(preset.workoutNotes?.trim()) ||
      (preset.exercises || []).some((ex) => Boolean(ex.baseNotes?.trim()));
    if (!hasNotes) return false;
  }

  // 10. Includes Exercise / Cue Text
  if (f.exerciseCueQuery.trim()) {
    const q = f.exerciseCueQuery.trim().toLowerCase();
    const matched =
      (preset.workoutNotes || '').toLowerCase().includes(q) ||
      (preset.exercises || []).some(
        (ex) =>
          (ex.exerciseName || '').toLowerCase().includes(q) ||
          (ex.baseNotes || '').toLowerCase().includes(q)
      );
    if (!matched) return false;
  }

  return true;
}

export function sortLibraryPresets(
  presets: WorkoutPreset[],
  sortBy: LibrarySortOption
): WorkoutPreset[] {
  const list = [...presets];
  if (sortBy === 'title_asc') {
    return list.sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
    );
  }
  if (sortBy === 'duration_asc') {
    return list.sort((a, b) => {
      const da = a.durationMinutes && a.durationMinutes > 0 ? a.durationMinutes : Number.MAX_SAFE_INTEGER;
      const db = b.durationMinutes && b.durationMinutes > 0 ? b.durationMinutes : Number.MAX_SAFE_INTEGER;
      return da - db || (a.title || '').localeCompare(b.title || '');
    });
  }
  if (sortBy === 'duration_desc') {
    return list.sort((a, b) => {
      const da = a.durationMinutes && a.durationMinutes > 0 ? a.durationMinutes : -1;
      const db = b.durationMinutes && b.durationMinutes > 0 ? b.durationMinutes : -1;
      return db - da || (a.title || '').localeCompare(b.title || '');
    });
  }
  if (sortBy === 'exercises_desc') {
    return list.sort(
      (a, b) =>
        (b.exercises?.length || 0) - (a.exercises?.length || 0) ||
        (a.title || '').localeCompare(b.title || '')
    );
  }
  if (sortBy === 'updated_desc') {
    return list.sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '')
    );
  }
  return list;
}
