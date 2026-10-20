// Steps that make something, where an admin sets up checks: Add a check, Make
// your own, and a step's editor (StepMaking.tsx). They load the first time a
// language's checks are opened (decisions.md 123 and 147), as one file for
// all three: Metro moves whatever two lazily loaded files share into the
// file every first visit downloads.
import { Suspense, type ComponentProps } from 'react';
import { readModule, registerLoader } from '../shell/lazyModules';
import type { MakesFields as Fields, MakeStepSheet as Sheet, MakingPresets as Presets } from './StepMaking';

const loadStepMaking = () => import('./StepMaking');
registerLoader(loadStepMaking);

function PresetsLoaded(props: ComponentProps<typeof Presets>) {
  const { MakingPresets: Shown } = readModule(loadStepMaking);
  return <Shown {...props} />;
}

function SheetLoaded(props: ComponentProps<typeof Sheet>) {
  const { MakeStepSheet: Shown } = readModule(loadStepMaking);
  return <Shown {...props} />;
}

function FieldsLoaded(props: ComponentProps<typeof Fields>) {
  const { MakesFields: Shown } = readModule(loadStepMaking);
  return <Shown {...props} />;
}

export function MakingPresets(props: ComponentProps<typeof Presets>) {
  return <Suspense fallback={null}><PresetsLoaded {...props} /></Suspense>;
}

export function MakeStepSheet(props: ComponentProps<typeof Sheet>) {
  return <Suspense fallback={null}><SheetLoaded {...props} /></Suspense>;
}

export function MakesFields(props: ComponentProps<typeof Fields>) {
  return <Suspense fallback={null}><FieldsLoaded {...props} /></Suspense>;
}
