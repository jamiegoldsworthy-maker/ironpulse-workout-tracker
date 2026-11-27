import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  Layers,
  Tag,
  Timer,
  X,
  Zap,
} from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { BulkPresetPatch } from '../store/useWorkoutStore';
import { WorkoutPreset, WorkoutProgram } from '../types/workout';

interface BulkEditWorkoutsModalProps {
  open: boolean;
  selectedPresets: WorkoutPreset[];
  programs: WorkoutProgram[];
  categories: string[];
  allTags: string[];
  onClose: () => void;
  onApply: (patch: BulkPresetPatch) => Promise<void>;
}

export const BulkEditWorkoutsModal: React.FC<BulkEditWorkoutsModalProps> = ({
  open,
  selectedPresets,
  programs,
  categories,
  allTags,
  onClose,
  onApply,
}) => {
  const [programsMode, setProgramsMode] = useState<'no_change' | 'add' | 'remove' | 'replace'>(
    'no_change'
  );
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);

  const [addTagsInput, setAddTagsInput] = useState<string>('');
  const [selectedAddTags, setSelectedAddTags] = useState<string[]>([]);
  const [selectedRemoveTags, setSelectedRemoveTags] = useState<string[]>([]);

  const [categoryValue, setCategoryValue] = useState<string>('');

  const [durationMode, setDurationMode] = useState<'no_change' | 'set' | 'clear'>('no_change');
  const [durationMinutesInput, setDurationMinutesInput] = useState<string>('15');

  const [biteSizeMode, setBiteSizeMode] = useState<'no_change' | 'on' | 'off'>('no_change');

  const [structureMode, setStructureMode] = useState<
    'no_change' | 'standard' | 'circuit' | 'emom_rotating' | 'emom_complex' | 'amrap'
  >('no_change');
  const [timeCapMinutesInput, setTimeCapMinutesInput] = useState<string>('10');
  const [defaultRestSecInput, setDefaultRestSecInput] = useState<string>('60');
  const [defaultRoundsInput, setDefaultRoundsInput] = useState<string>('12');
  const [defaultWorkSecInput, setDefaultWorkSecInput] = useState<string>('60');

  const [isSaving, setIsSaving] = useState(false);

  // Reset form to pure "No Change" whenever opened
  useEffect(() => {
    if (!open) return;
    setProgramsMode('no_change');
    setSelectedProgramIds([]);
    setAddTagsInput('');
    setSelectedAddTags([]);
    setSelectedRemoveTags([]);
    setCategoryValue('');
    setDurationMode('no_change');
    setDurationMinutesInput('15');
    setBiteSizeMode('no_change');
    setStructureMode('no_change');
    setTimeCapMinutesInput('10');
    setDefaultRestSecInput('60');
    setDefaultRoundsInput('12');
    setDefaultWorkSecInput('60');
    setIsSaving(false);
  }, [open]);

  const tagsPresentOnSelected = useMemo(() => {
    const set = new Set<string>();
    for (const p of selectedPresets) {
      for (const t of p.tags || []) {
        set.add(t);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [selectedPresets]);

  const parsedAddTags = useMemo(() => {
    const typed = addTagsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set([...selectedAddTags, ...typed]));
  }, [addTagsInput, selectedAddTags]);

  const activeChangeCount = useMemo(() => {
    let n = 0;
    if (
      programsMode === 'replace' ||
      ((programsMode === 'add' || programsMode === 'remove') && selectedProgramIds.length > 0)
    ) {
      n += 1;
    }
    if (parsedAddTags.length > 0 || selectedRemoveTags.length > 0) n += 1;
    if (categoryValue) n += 1;
    if (durationMode !== 'no_change') n += 1;
    if (biteSizeMode !== 'no_change') n += 1;
    if (structureMode !== 'no_change') n += 1;
    return n;
  }, [
    programsMode,
    selectedProgramIds.length,
    parsedAddTags.length,
    selectedRemoveTags.length,
    categoryValue,
    durationMode,
    biteSizeMode,
    structureMode,
  ]);

  const toggleInList = (list: string[], val: string, setter: (next: string[]) => void) => {
    setter(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
  };

  const handleSubmit = async () => {
    if (activeChangeCount === 0 || selectedPresets.length === 0) return;
    setIsSaving(true);
    const patch: BulkPresetPatch = {};

    if (
      programsMode === 'replace' ||
      ((programsMode === 'add' || programsMode === 'remove') && selectedProgramIds.length > 0)
    ) {
      patch.programsMode = programsMode;
      patch.programIds = selectedProgramIds;
    }
    if (parsedAddTags.length > 0) {
      patch.addTags = parsedAddTags;
    }
    if (selectedRemoveTags.length > 0) {
      patch.removeTags = selectedRemoveTags;
    }
    if (categoryValue) {
      patch.category = categoryValue;
    }
    if (durationMode === 'set') {
      const parsedMin = Math.max(1, Math.round(Number(durationMinutesInput) || 1));
      patch.durationMode = 'set';
      patch.durationMinutes = parsedMin;
    } else if (durationMode === 'clear') {
      patch.durationMode = 'clear';
    }
    if (biteSizeMode !== 'no_change') {
      patch.biteSizeMode = biteSizeMode;
    }
    if (structureMode !== 'no_change') {
      patch.structureMode = structureMode;
      if (structureMode === 'standard') {
        patch.defaultRestSec = Math.max(0, parseInt(defaultRestSecInput, 10) || 0);
      } else if (structureMode === 'circuit') {
        patch.defaultRounds = Math.max(1, parseInt(defaultRoundsInput, 10) || 12);
        patch.defaultWorkSec = Math.max(0, parseInt(defaultWorkSecInput, 10) || 40);
        patch.defaultRestSec = Math.max(0, parseInt(defaultRestSecInput, 10) || 20);
      } else if (structureMode === 'amrap') {
        patch.timeCapMinutes = Math.max(1, parseInt(timeCapMinutesInput, 10) || 10);
      } else {
        patch.defaultRounds = Math.max(1, parseInt(defaultRoundsInput, 10) || 10);
        patch.defaultWorkSec = Math.max(10, parseInt(defaultWorkSecInput, 10) || 60);
        patch.defaultRestSec = 0;
      }
    }

    await onApply(patch);
    setIsSaving(false);
  };

  return (
    <ModalPortal open={open} onClose={() => !isSaving && onClose()} tier="primary" sheetOnMobile>
      <div className="w-full max-w-xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div>
            <h3 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100">
              Bulk Edit Workouts ({selectedPresets.length})
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All fields stay <strong className="text-slate-700 dark:text-slate-300">No Change</strong> unless explicitly modified below.
            </p>
          </div>
          <button
            type="button"
            disabled={isSaving}
            onClick={onClose}
            aria-label="Close bulk edit modal"
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain space-y-4 flex-1">
          {/* 1. Programs */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-orange-500" />
                Programs
              </span>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { id: 'no_change', label: 'No Change' },
                    { id: 'add', label: 'Add to' },
                    { id: 'remove', label: 'Remove from' },
                    { id: 'replace', label: 'Replace' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setProgramsMode(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      programsMode === opt.id
                        ? 'bg-orange-500 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {programsMode !== 'no_change' && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {programs.length === 0 ? (
                  <span className="text-[11px] text-slate-400">No programs created yet.</span>
                ) : (
                  programs.map((prog) => {
                    const active = selectedProgramIds.includes(prog.programUuid);
                    return (
                      <button
                        key={prog.programUuid}
                        type="button"
                        onClick={() =>
                          toggleInList(selectedProgramIds, prog.programUuid, setSelectedProgramIds)
                        }
                        className={`px-2.5 py-1 rounded-xl text-xs font-semibold border inline-flex items-center gap-1 transition-colors ${
                          active
                            ? 'bg-orange-500/15 border-orange-500 text-orange-600 dark:text-orange-400'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                        {prog.title}
                      </button>
                    );
                  })
                )}
                {programsMode === 'replace' && selectedProgramIds.length === 0 && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 w-full">
                    Tip: Leave all unchecked to clear programs from selected workouts.
                  </span>
                )}
              </div>
            )}
          </div>

          {/* 2. Tags */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2.5">
            <span className="text-xs font-bold flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-orange-500" />
              Tags (Add / Remove)
            </span>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Add Tag(s) — comma-separated or tap existing
              </label>
              <input
                type="text"
                value={addTagsInput}
                onChange={(e) => setAddTagsInput(e.target.value)}
                placeholder="e.g. Kettlebell, Rehab, Home Gym"
                className="w-full px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-orange-500"
              />
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {allTags.slice(0, 18).map((tag) => {
                    const active = selectedAddTags.includes(tag);
                    return (
                      <button
                        key={`add-${tag}`}
                        type="button"
                        onClick={() => toggleInList(selectedAddTags, tag, setSelectedAddTags)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                          active
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        + #{tag}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {tagsPresentOnSelected.length > 0 && (
              <div className="space-y-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Remove Tag(s) from selected
                </label>
                <div className="flex flex-wrap gap-1">
                  {tagsPresentOnSelected.map((tag) => {
                    const active = selectedRemoveTags.includes(tag);
                    return (
                      <button
                        key={`rm-${tag}`}
                        type="button"
                        onClick={() =>
                          toggleInList(selectedRemoveTags, tag, setSelectedRemoveTags)
                        }
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border transition-colors ${
                          active
                            ? 'bg-rose-500/15 border-rose-500 text-rose-600 dark:text-rose-400 line-through'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500'
                        }`}
                      >
                        × #{tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. Category & Bite-Size Flag */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
              <label className="block text-xs font-bold">Category</label>
              <select
                value={categoryValue}
                onChange={(e) => setCategoryValue(e.target.value)}
                className="w-full px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">No Change</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
              <span className="text-xs font-bold flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-amber-500 fill-current" />
                Bite-Size Flag
              </span>
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'no_change', label: 'No Change' },
                    { id: 'on', label: 'On' },
                    { id: 'off', label: 'Off' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setBiteSizeMode(opt.id)}
                    className={`py-1.5 px-2 rounded-xl text-[11px] font-bold transition-colors ${
                      biteSizeMode === opt.id
                        ? 'bg-orange-500 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 4. Target Duration (mins) */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-orange-500" />
                Target Duration (mins)
              </span>
              <div className="flex gap-1">
                {(
                  [
                    { id: 'no_change', label: 'No Change' },
                    { id: 'set', label: 'Set (mins)' },
                    { id: 'clear', label: 'Clear' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setDurationMode(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                      durationMode === opt.id
                        ? 'bg-orange-500 text-white'
                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {durationMode === 'set' && (
              <div className="flex items-center gap-2 pt-0.5">
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={durationMinutesInput}
                  onChange={(e) => setDurationMinutesInput(e.target.value)}
                  className="w-24 px-3 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <span className="text-xs text-slate-500">minutes</span>
              </div>
            )}
          </div>

          {/* 5. Default Structure & Timer */}
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold flex items-center gap-1.5">
                <Timer className="w-3.5 h-3.5 text-orange-500" />
                Default Structure &amp; Timer
              </span>
              <select
                value={structureMode}
                onChange={(e) => {
                  const nextMode = e.target.value as typeof structureMode;
                  setStructureMode(nextMode);
                  if (nextMode === 'standard') {
                    setDefaultRestSecInput('60');
                  } else if (nextMode === 'circuit') {
                    setDefaultRoundsInput('12');
                    setDefaultWorkSecInput('40');
                    setDefaultRestSecInput('20');
                  } else if (nextMode === 'emom_rotating') {
                    setDefaultRoundsInput('10');
                    setDefaultWorkSecInput('60');
                    setDefaultRestSecInput('0');
                  } else if (nextMode === 'emom_complex') {
                    setDefaultRoundsInput('15');
                    setDefaultWorkSecInput('60');
                    setDefaultRestSecInput('0');
                  }
                }}
                className="px-3 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="no_change">No Change</option>
                <option value="standard">Standard (Straight Sets)</option>
                <option value="circuit">Circuit</option>
                <option value="emom_rotating">Rotating EMOM (1 Move / Min)</option>
                <option value="emom_complex">EMOM / Complex (Multi-Round)</option>
                <option value="amrap">AMRAP (Time Cap)</option>
              </select>
            </div>

            {structureMode === 'amrap' && (
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-500">
                  Time Cap (mins):
                </label>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={timeCapMinutesInput}
                  onChange={(e) => setTimeCapMinutesInput(e.target.value)}
                  className="w-20 px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <span className="text-[11px] text-slate-400">Synced with Target Duration</span>
              </div>
            )}

            {structureMode === 'standard' && (
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-semibold text-slate-500">
                  Default Rest (sec):
                </label>
                <input
                  type="number"
                  min={0}
                  max={600}
                  value={defaultRestSecInput}
                  onChange={(e) => setDefaultRestSecInput(e.target.value)}
                  className="w-20 px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <span className="text-[11px] text-slate-400">(0 = No Rest)</span>
              </div>
            )}

            {structureMode === 'circuit' && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Rounds
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={defaultRoundsInput}
                    onChange={(e) => setDefaultRoundsInput(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Work (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={defaultWorkSecInput}
                    onChange={(e) => setDefaultWorkSecInput(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Rest (sec)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={defaultRestSecInput}
                    onChange={(e) => setDefaultRestSecInput(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
            )}

            {(structureMode === 'emom_rotating' || structureMode === 'emom_complex') && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    {structureMode === 'emom_rotating' ? 'Total Minutes' : 'Default Rounds'}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={defaultRoundsInput}
                    onChange={(e) => setDefaultRoundsInput(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                    Interval (sec)
                  </label>
                  <input
                    type="number"
                    min={10}
                    value={defaultWorkSecInput}
                    onChange={(e) => setDefaultWorkSecInput(e.target.value)}
                    className="w-full px-2.5 py-1 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] font-semibold text-slate-500">
            {activeChangeCount === 0
              ? 'Modify at least 1 field above'
              : `${activeChangeCount} field${activeChangeCount === 1 ? '' : 's'} will be updated`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isSaving || activeChangeCount === 0}
              onClick={() => void handleSubmit()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white shadow-sm transition-colors"
            >
              {isSaving
                ? 'Updating...'
                : `Apply to ${selectedPresets.length} Workout${
                    selectedPresets.length === 1 ? '' : 's'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
