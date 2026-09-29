// Placeholder while this domain is being built.
import type { Ctx } from '../ctx';
import { EmptyState, Header, Screen } from '../kit';
import { TITLES } from '../flow';

export function TemplatesHome(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.templates_home} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function TemplatePicker(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.template_picker} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function TemplateEditor(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.template_editor} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

export function BookStructure(ctx: Ctx) {
  return <Screen header={<Header title={TITLES.book_structure} onBack={ctx.back} />}><EmptyState title="Coming soon" /></Screen>;
}

