/**
 * lib/corpus/upgrade-rules.ts
 *
 * C/AL → AL mapping rules (design §7). Table-driven: each rule turns one kind
 * of delta into a finding with an AL target and a default effort. Tune the
 * RULES table, not the engine.
 *
 * Publisher availability for event subscribers can't be checked until a
 * target-BC AL corpus exists (phase 5), so those findings say "confirm publisher".
 */

import type { ObjectDelta, IdRange } from './delta'
import { isDocumentationOnly, inRanges } from './delta'

export type Effort = 'none' | 'low' | 'medium' | 'high'

const EFFORT_ORDER: Effort[] = ['none', 'low', 'medium', 'high']

export function maxEffort(findings: Array<{ effort: Effort }>): Effort {
  let best = 0
  for (const f of findings) best = Math.max(best, EFFORT_ORDER.indexOf(f.effort))
  return EFFORT_ORDER[best]
}

export type FindingCode =
  | 'new_object'
  | 'new_legacy_object'
  | 'new_menusuite'
  | 'isv_object'
  | 'doc_only'
  | 'field_added'
  | 'field_added_out_of_range'
  | 'field_removed'
  | 'field_definition_changed'
  | 'field_trigger_code'
  | 'object_trigger_code'
  | 'object_property_changed'
  | 'key_added'
  | 'key_changed_or_removed'
  | 'procedure_added'
  | 'procedure_changed'
  | 'procedure_removed'
  | 'control_added'
  | 'control_removed'
  | 'control_changed'
  | 'control_trigger_code'
  | 'action_added'
  | 'action_changed_or_removed'
  | 'action_trigger_code'
  | 'report_modified'
  | 'report_layout_only'
  | 'xmlport_or_query_modified'
  | 'legacy_object_modified'
  | 'menusuite_modified'
  | 'other_section_changed'

export interface Rule { alTarget: string; effort: Effort; note: string }

/** The rule table. Edit here to tune targets and effort. */
export const RULES: Record<FindingCode, Rule> = {
  new_object:                 { alTarget: 'Same object type via Txt2AL', effort: 'low', note: 'Convert and renumber into the extension ID range if needed.' },
  new_legacy_object:          { alTarget: 'Page / XMLport', effort: 'medium', note: 'Forms and dataports must be transformed before Txt2AL.' },
  new_menusuite:              { alTarget: 'Role centre / search', effort: 'low', note: 'MenuSuites have no AL equivalent; expose objects via role centres or search.' },
  isv_object:                 { alTarget: 'Vendor-supplied AL version', effort: 'none', note: 'Outside the customer range and not standard — ISV/vertical. The vendor must supply the AL version.' },
  doc_only:                   { alTarget: 'Nothing to migrate', effort: 'none', note: 'Only the documentation trigger differs.' },
  field_added:                { alTarget: 'tableextension field', effort: 'low', note: 'Field number is in the customer range.' },
  field_added_out_of_range:   { alTarget: 'tableextension field + renumber + data upgrade', effort: 'medium', note: 'Field number is outside the customer range; must be renumbered and data moved.' },
  field_removed:              { alTarget: 'Not possible in an extension', effort: 'high', note: 'Standard fields cannot be removed; redesign required.' },
  field_definition_changed:   { alTarget: 'Not extensible — review', effort: 'high', note: 'Changed properties on a standard field (type, length, options, relation…) cannot be made from an extension. Some captions/options may move to enum extensions — check the target version.' },
  field_trigger_code:         { alTarget: 'Subscriber to OnBefore/OnAfterValidateEvent (platform)', effort: 'low', note: 'Platform field events exist for every table field; check ordering relative to standard code.' },
  object_trigger_code:        { alTarget: 'Subscriber to platform trigger events / extension trigger', effort: 'medium', note: 'OnInsert/OnModify/OnDelete/OnOpenPage etc. have platform events or extension triggers; behaviour placed mid-trigger may need a business event — confirm publisher.' },
  object_property_changed:    { alTarget: 'Review — some properties are extensible', effort: 'medium', note: 'E.g. LookupPageID/DrillDownPageID/Permissions behave differently in extensions.' },
  key_added:                  { alTarget: 'tableextension key', effort: 'low', note: 'Keys can be added from a table extension.' },
  key_changed_or_removed:     { alTarget: 'Not possible in an extension', effort: 'high', note: 'Standard keys cannot be changed or removed.' },
  procedure_added:            { alTarget: 'Procedure in extension object or codeunit', effort: 'low', note: 'New procedure on a standard object.' },
  procedure_changed:          { alTarget: 'Event subscriber — confirm publisher', effort: 'medium', note: 'Code changed inside a standard procedure. Needs a suitable integration event in the target version; otherwise redesign or request one.' },
  procedure_removed:          { alTarget: 'Redesign', effort: 'high', note: 'A standard procedure was removed.' },
  control_added:              { alTarget: 'pageextension addafter/addbefore', effort: 'low', note: 'New control on a standard page.' },
  control_removed:            { alTarget: 'Hide (Visible = false) or personalise', effort: 'medium', note: 'Standard controls cannot be removed from an extension.' },
  control_changed:            { alTarget: 'pageextension modify / move — review', effort: 'medium', note: 'Some control properties can be modified; moves are limited.' },
  control_trigger_code:       { alTarget: 'pageextension modify() trigger', effort: 'medium', note: 'Code on a standard control trigger.' },
  action_added:               { alTarget: 'pageextension actions', effort: 'low', note: 'New action on a standard page.' },
  action_changed_or_removed:  { alTarget: 'pageextension modify / hide — review', effort: 'medium', note: 'Standard actions cannot be removed; promote/visibility changes may be possible.' },
  action_trigger_code:        { alTarget: 'pageextension modify(action) OnBefore/OnAfterAction', effort: 'medium', note: 'Code on a standard action trigger.' },
  report_modified:            { alTarget: 'Copy as new report + report selection / substitution', effort: 'medium', note: 'Standard reports cannot be extended in BC 14-era targets; copy and substitute.' },
  report_layout_only:         { alTarget: 'Custom report layout', effort: 'low', note: 'Only the RDLC/Word layout differs.' },
  xmlport_or_query_modified:  { alTarget: 'Copy as new object', effort: 'medium', note: 'XMLports and queries cannot be extended.' },
  legacy_object_modified:     { alTarget: 'Transform form/dataport, then re-apply', effort: 'high', note: 'Modified standard form or dataport.' },
  menusuite_modified:         { alTarget: 'Role centre / search', effort: 'low', note: 'MenuSuites have no AL equivalent.' },
  other_section_changed:      { alTarget: 'Review', effort: 'medium', note: 'A section the rules do not classify yet changed.' },
}

export interface Finding {
  code:     FindingCode
  /** What changed: field numbers, procedure names, control ids, key field lists… */
  items:    string[]
  alTarget: string
  effort:   Effort
  note:     string
}

function finding(code: FindingCode, items: string[] = []): Finding {
  const r = RULES[code]
  return { code, items, alTarget: r.alTarget, effort: r.effort, note: r.note }
}

const LEGACY = new Set(['form', 'dataport'])

/** Map one object's delta to AL findings. */
export function mapToAl(delta: ObjectDelta, customRanges: IdRange[]): Finding[] {
  const type = delta.objectType.toLowerCase()

  if (delta.origin === 'standard_unmodified') return []
  if (delta.origin === 'isv_or_unknown') return [finding('isv_object')]
  if (delta.origin === 'custom_new') {
    if (type === 'menusuite') return [finding('new_menusuite')]
    if (LEGACY.has(type)) return [finding('new_legacy_object')]
    return [finding('new_object')]
  }

  const d = delta.diff
  if (!d) return []
  if (isDocumentationOnly(d)) return [finding('doc_only')]

  // Whole-object rules first
  if (type === 'menusuite') return [finding('menusuite_modified')]
  if (LEGACY.has(type)) return [finding('legacy_object_modified')]
  if (type === 'report') {
    const changedSections = d.sections.added.concat(d.sections.changed, d.sections.removed)
    const onlyLayout = changedSections.length > 0 && changedSections.every(s => s === 'RDLDATA' || s === 'WORDLAYOUT') &&
      !d.globalsChanged && !d.procedures.added.length && !d.procedures.changed.length && !d.procedures.removed.length &&
      !d.triggers.added.length && !d.triggers.changed.length && !d.triggers.removed.length &&
      !d.controls.added.length && !d.controls.removed.length && !d.controls.defChanged.length && !d.controls.code.length &&
      !d.properties.added.length && !d.properties.changed.length && !d.properties.removed.length
    return [finding(onlyLayout ? 'report_layout_only' : 'report_modified')]
  }
  if (type === 'xmlport' || type === 'query') return [finding('xmlport_or_query_modified')]

  const out: Finding[] = []
  const push = (code: FindingCode, items: string[]) => { if (items.length) out.push(finding(code, items)) }

  // Fields
  const added = d.fields.added
  push('field_added', added.filter(id => inRanges(parseInt(id, 10), customRanges)))
  push('field_added_out_of_range', added.filter(id => !inRanges(parseInt(id, 10), customRanges)))
  push('field_removed', d.fields.removed)
  push('field_definition_changed', d.fields.defChanged)
  push('field_trigger_code', d.fields.code.map(c => c.id + ' (' + c.triggers.join(', ') + ')'))

  // Keys
  push('key_added', d.keys.added)
  push('key_changed_or_removed', d.keys.changed.concat(d.keys.removed))

  // Object triggers and properties
  push('object_trigger_code', d.triggers.added.concat(d.triggers.changed, d.triggers.removed))
  push('object_property_changed', d.properties.added.concat(d.properties.changed, d.properties.removed))

  // Pages: controls and actions
  push('control_added', d.controls.added)
  push('control_removed', d.controls.removed)
  push('control_changed', d.controls.defChanged)
  push('control_trigger_code', d.controls.code.map(c => c.id + ' (' + c.triggers.join(', ') + ')'))
  push('action_added', d.actions.added)
  push('action_changed_or_removed', d.actions.defChanged.concat(d.actions.removed))
  push('action_trigger_code', d.actions.code.map(c => c.id + ' (' + c.triggers.join(', ') + ')'))

  // Code
  push('procedure_added', d.procedures.added)
  push('procedure_changed', d.procedures.changed)
  push('procedure_removed', d.procedures.removed)

  // Anything else (FIELDGROUPS, ELEMENTS, LABELS …)
  push('other_section_changed', d.sections.added.concat(d.sections.changed, d.sections.removed))

  // Globals changed alone (e.g. a new variable that nothing uses yet) — still a modification
  if (!out.length && d.globalsChanged) push('procedure_changed', ['(global variables)'])

  return out
}
