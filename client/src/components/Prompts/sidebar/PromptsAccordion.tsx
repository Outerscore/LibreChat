import { SystemRoles } from 'librechat-data-provider';
import AutoSendPrompt from '../buttons/AutoSendPrompt';
import { AdminSettings } from '~/components/Prompts';
import PromptSidePanel from './GroupSidePanel';
import FilterPrompts from './FilterPrompts';
import { useAuthContext } from '~/hooks';

export default function PromptsAccordion() {
  const { user } = useAuthContext();
  return (
    <PromptSidePanel className="space-y-2 pt-2">
      <FilterPrompts />
      {user?.role === SystemRoles.ADMIN && <AdminSettings />}
      <AutoSendPrompt />
    </PromptSidePanel>
  );
}
