export type UiLanguage = 'en' | 'es' | 'fr';
let currentLanguage: UiLanguage = 'en';
const dictionary: Record<string, [string, string]> = {
  'Settings': ['Ajustes', 'Paramètres'], 'Account': ['Cuenta', 'Compte'],
  'App': ['Aplicación', 'Application'], 'Edit profile': ['Editar perfil', 'Modifier le profil'],
  'Switch organization': ['Cambiar organización', 'Changer d’organisation'],
  'Sign out': ['Cerrar sesión', 'Se déconnecter'], 'Sign in': ['Iniciar sesión', 'Se connecter'],
  'Create account': ['Crear cuenta', 'Créer un compte'], 'Password': ['Contraseña', 'Mot de passe'],
  'Forgot password?': ['¿Olvidaste la contraseña?', 'Mot de passe oublié ?'],
  'Save': ['Guardar', 'Enregistrer'], 'Cancel': ['Cancelar', 'Annuler'],
  'Continue': ['Continuar', 'Continuer'], 'Back': ['Atrás', 'Retour'],
  'Next': ['Siguiente', 'Suivant'], 'Done': ['Listo', 'Terminé'],
  'Profile': ['Perfil', 'Profil'], 'Save profile': ['Guardar perfil', 'Enregistrer le profil'],
  'Inbox': ['Bandeja de entrada', 'Boîte de réception'],
  'Your work': ['Tu trabajo', 'Votre travail'], 'My work': ['Mi trabajo', 'Mon travail'],
  'Status': ['Estado', 'État'], 'Sync': ['Sincronización', 'Synchronisation'],
  'Sync now': ['Sincronizar ahora', 'Synchroniser'],
  'Enable notifications': ['Activar notificaciones', 'Activer les notifications'],
  'Privacy and security': ['Privacidad y seguridad', 'Confidentialité et sécurité'],
  'Change password': ['Cambiar contraseña', 'Changer le mot de passe'],
  'New password': ['Nueva contraseña', 'Nouveau mot de passe'],
  'Confirm password': ['Confirmar contraseña', 'Confirmer le mot de passe'],
  'Update password': ['Actualizar contraseña', 'Mettre à jour le mot de passe'],
  'Appearance': ['Apariencia', 'Apparence'], 'System': ['Sistema', 'Système'],
  'Light': ['Claro', 'Clair'], 'Dark': ['Oscuro', 'Sombre'],
  'App language': ['Idioma de la aplicación', 'Langue de l’application'],
  'Entry PIN': ['PIN de acceso', 'Code d’accès'], 'Unlock': ['Desbloquear', 'Déverrouiller'],
  'Set PIN': ['Establecer PIN', 'Définir un code'], 'Remove PIN': ['Eliminar PIN', 'Supprimer le code'],
  'Lock now': ['Bloquear ahora', 'Verrouiller'],
  'Disguise icon': ['Disfrazar icono', 'Icône discrète'],
  'Delete account': ['Eliminar cuenta', 'Supprimer le compte'],
  'Restore account': ['Restaurar cuenta', 'Restaurer le compte'],
  'Record': ['Grabar', 'Enregistrer'], 'Review': ['Revisar', 'Réviser'],
  'Translate': ['Traducir', 'Traduire'], 'Projects': ['Proyectos', 'Projets'],
  'Organization': ['Organización', 'Organisation'], 'Members': ['Miembros', 'Membres'],
  'Languages': ['Idiomas', 'Langues'], 'Reference material': ['Material de referencia', 'Documents de référence'],
  'Play': ['Reproducir', 'Lire'], 'Pause': ['Pausar', 'Pause'],
  'Share audio': ['Compartir audio', 'Partager l’audio'],
};
/** Untranslated project/user content is deliberately left intact. */
export function translateUi(label: string): string {
  return currentLanguage === 'en' ? label : dictionary[label]?.[currentLanguage === 'es' ? 0 : 1] ?? label;
}
export function applyUiLanguage(language: UiLanguage) { currentLanguage = language; }
