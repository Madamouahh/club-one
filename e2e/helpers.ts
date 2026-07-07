import { Page, expect } from "@playwright/test";

// Identifiants de TEST du LABO local (Docker club-one-lab) — jamais la prod, jamais des vrais secrets.
// Mot de passe posé sur auth.users du LABO pour l'E2E (E2ELabPass!23).
export const LAB_USERS = {
  admin: { user: "lab-admin-01", pass: "E2ELabPass!23" },
  manager: { user: "lab-manager-01", pass: "E2ELabPass!23" },
  promoter: { user: "lab-promoter-01", pass: "E2ELabPass!23" },
  server: { user: "server", pass: "E2ELabPass!23" },
} as const;

export async function loginStaff(page: Page, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  // networkidle : attendre la fin de l'hydratation avant de taper (sinon onChange React ne capte pas
  // la saisie → état vide → login sans requête).
  await page.goto("/", { waitUntil: "networkidle" });
  const id = page.getByPlaceholder("Identifiant");
  const code = page.getByPlaceholder("Code");
  await id.waitFor({ state: "visible" });
  // Saisie caractère par caractère (déclenche onChange React sur les inputs contrôlés — fill() posait
  // la valeur DOM sans mettre à jour l'état, d'où un login sans requête). On vérifie que l'état a pris.
  await id.click();
  await id.pressSequentially(user, { delay: 15 });
  await code.click();
  await code.pressSequentially(pass, { delay: 15 });
  await expect(id).toHaveValue(user);
  await expect(code).toHaveValue(pass);
  await page.getByRole("button", { name: /entrer|connexion|se connecter|valider/i }).first().click();
  // Après login : l'écran de connexion disparaît (plus de champ "Identifiant").
  await expect(page.getByPlaceholder("Identifiant")).toHaveCount(0, { timeout: 20000 });
}

// Nav hiérarchique : bas = GROUPES (clé soiree/equipes/operations/relation/gestion/direction),
// sous-barre = onglets du groupe (clé APP_TABS). data-testid pose des ancres stables (les libellés
// se collisionnent : groupe "Clients" vs onglet "clients"). Cliquer le groupe puis l'onglet.
export async function gotoTab(page: Page, groupKey: string, tabKey: string) {
  await page.getByTestId(`navgroup-${groupKey}`).click();
  const tab = page.getByTestId(`navtab-${tabKey}`);
  await tab.waitFor({ state: "visible", timeout: 10000 });
  await tab.click();
}
