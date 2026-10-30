// The new-language wizard's state: which step and page it is on, what has been
// typed or picked, and what Continue is doing. The decisions are in
// newLanguageModel.ts; the screen lays out.
import { useRef, useState } from 'react';
import type { LanguoidHit } from './languoidModel';
import type { LanguageScope } from './orgAdmin';
import type { Making, NewOne } from './newLanguage';
import type { FlowPage, LanguagePage, MaterialPage } from './newLanguageModel';

export function useNewLanguage(fromCluster: string | null) {
  const [step, setStep] = useState(0);
  // The language's step, two pages: its name, then the languages its translators use (decision 193).
  const [languagePage, setLanguagePage] = useState<LanguagePage>('name');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  // Picked from the language list (docs/languoids.md); none leaves it unlinked, to link from its page later.
  const [picked, setPicked] = useState<LanguoidHit | null>(null);
  // One language, or a cluster of several (decision 108, demo ADR-045).
  const [many, setMany] = useState(false);
  // One language: the cluster it joins (an id, NEW_CLUSTER, or none), and a new one's name.
  const [joins, setJoins] = useState<string | null>(fromCluster);
  const [newCluster, setNewCluster] = useState('');
  // A cluster: its name, the new languages it brings, and those already here it takes in.
  const [clusterTitle, setClusterTitle] = useState('');
  const [batch, setBatch] = useState<NewOne[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  // Languages already added by a Continue that failed partway: tried again, they are not added twice.
  const madeRef = useRef(new Map<string, { languageId: string; name: string }>());
  const [scope, setScope] = useState<LanguageScope>('nt');
  const [chosenBooks, setChosenBooks] = useState<Set<string>>(new Set());
  // Reference material: what its team will have, in the languages asked after the name; those can be changed from it.
  const [materialPage, setMaterialPage] = useState<MaterialPage>('material');
  // Material ticked or unticked by hand; the rest keeps what is suggested.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // The review flow, two pages: which to start from, then its checks.
  const [flowPage, setFlowPage] = useState<FlowPage>('pick');
  const [flowKey, setFlowKey] = useState<string | null>(null);
  const [moreFlows, setMoreFlows] = useState(false);
  // Another flow picked after its checks were changed: asked first, since the changes go (decision 134).
  const [startAgain, setStartAgain] = useState(false);
  // What Continue is doing now, of the parts it will do (the checks page shows them while it runs).
  const [making, setMaking] = useState<{ parts: Making[]; now: Making } | null>(null);
  const [created, setCreated] = useState<{ languages: { languageId: string; name: string }[]; cluster: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The languages its translators use, picked: its Bibles, guides, templates, flows and book names follow them. None until someone does.
  const [readsPicked, setReadsPicked] = useState<string[] | null>(null);
  return {
    step, setStep, languagePage, setLanguagePage, name, setName, code, setCode, picked, setPicked, many, setMany, joins, setJoins, newCluster, setNewCluster,
    clusterTitle, setClusterTitle, batch, setBatch, existing, setExisting, madeRef, scope, setScope, chosenBooks, setChosenBooks,
    materialPage, setMaterialPage, ticked, setTicked, flowPage, setFlowPage, flowKey, setFlowKey, moreFlows, setMoreFlows,
    startAgain, setStartAgain, making, setMaking, created, setCreated, busy, setBusy, error, setError, readsPicked, setReadsPicked
  };
}
