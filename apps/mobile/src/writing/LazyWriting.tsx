// Writing, loaded the first time someone writes or a written version is read
// (decisions.md 123 and 147): a team that only records never fetches it, and
// the web fetches it once the app has settled. The writing boxes, Say it or
// write it, and the reader of a written version (on the version page and in
// a review, which most people open) come as one file, because Metro moves
// whatever two lazily loaded files share into the file every first visit
// downloads.
import { Suspense, type ComponentProps } from 'react';
import { View } from 'react-native';
import { readModule, registerLoader } from '../shell/lazyModules';
import { C } from '../ui/theme';
import type { MakeChoice as Choice } from './MakeChoice';
import type { WritingWorkspace as Workspace } from './WritingWorkspace';
import type { WrittenReader as Reader } from './WrittenText';

const loadWriting = () => import('./WritingWorkspace');
registerLoader(loadWriting);

function WorkspaceLoaded(props: ComponentProps<typeof Workspace>) {
  const { WritingWorkspace: Shown } = readModule(loadWriting);
  return <Shown {...props} />;
}

function ChoiceLoaded(props: ComponentProps<typeof Choice>) {
  const { MakeChoice: Shown } = readModule(loadWriting);
  return <Shown {...props} />;
}

function ReaderLoaded(props: ComponentProps<typeof Reader>) {
  const { WrittenReader: Shown } = readModule(loadWriting);
  return <Shown {...props} />;
}

export function WritingWorkspace(props: ComponentProps<typeof Workspace>) {
  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: C.bg }} />}>
      <WorkspaceLoaded {...props} />
    </Suspense>
  );
}

export function MakeChoice(props: ComponentProps<typeof Choice>) {
  return (
    <Suspense fallback={<View style={{ flex: 1, backgroundColor: C.bg }} />}>
      <ChoiceLoaded {...props} />
    </Suspense>
  );
}

export function WrittenReader(props: ComponentProps<typeof Reader>) {
  return (
    <Suspense fallback={<View style={{ minHeight: 48 }} />}>
      <ReaderLoaded {...props} />
    </Suspense>
  );
}
