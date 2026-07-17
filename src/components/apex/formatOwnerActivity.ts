const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.logout': 'Sign-out',
  'auth.select_dealership': 'Dealership selected',
  'owner.dealership_enter': 'Owner entered rooftop',
  'owner.dealership_exit': 'Owner exited rooftop',
  'owner.national_access': 'National console viewed',
  'preferences.update': 'Language preference updated',
  'ro.create': 'Repair order created',
  'ro.update': 'Repair order updated',
  'story.generate': 'Story generated',
  'image.upload': 'Image uploaded',
};

export function formatOwnerActivityAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/\./g, ' · ');
}

export function formatOwnerActivityTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}