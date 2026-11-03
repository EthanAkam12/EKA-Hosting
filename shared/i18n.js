// The website's language: the few words the builder itself puts on pages
// (the rest is the owner's or the AI's own text), and its name for the AI.

export const LANGUAGES = {
  "en-GB": { name: "English (UK)", ai: "British English" },
  "en-US": { name: "English (US)", ai: "American English" },
  cy: { name: "Cymraeg (Welsh)", ai: "Welsh" },
  fr: { name: "Français", ai: "French" },
  de: { name: "Deutsch", ai: "German" },
  es: { name: "Español", ai: "Spanish" },
  it: { name: "Italiano", ai: "Italian" },
  nl: { name: "Nederlands", ai: "Dutch" },
  pt: { name: "Português", ai: "Portuguese" },
  pl: { name: "Polski", ai: "Polish" },
};

const EN = {
  choose: "Choose…", readMore: "Read more", soldOut: "Sold out", backTo: "Back to", home: "Home", noPosts: "No posts yet. Check back soon!",
  openMenu: "Open menu", call: "Call", showMap: "Show map", mapNote: "Loads Google Maps", playVideo: "Play video",
  cookieText: "We'd like to use cookies to understand how visitors use this website.", accept: "Accept", reject: "Reject", privacy: "Privacy policy", cookieSettings: "Cookie settings",
};

const WORDS = {
  "en-GB": EN,
  "en-US": EN,
  cy: { choose: "Dewiswch…", readMore: "Darllen mwy", soldOut: "Wedi gwerthu allan", backTo: "Yn ôl i", home: "Hafan", noPosts: "Dim postiadau eto. Dewch yn ôl yn fuan!", openMenu: "Agor y ddewislen", call: "Ffonio", showMap: "Dangos map", mapNote: "Yn llwytho Google Maps", playVideo: "Chwarae fideo", cookieText: "Hoffem ddefnyddio cwcis i ddeall sut mae ymwelwyr yn defnyddio'r wefan hon.", accept: "Derbyn", reject: "Gwrthod", privacy: "Polisi preifatrwydd", cookieSettings: "Gosodiadau cwcis" },
  fr: { choose: "Choisir…", readMore: "Lire la suite", soldOut: "Épuisé", backTo: "Retour à", home: "Accueil", noPosts: "Aucun article pour le moment. Revenez bientôt !", openMenu: "Ouvrir le menu", call: "Appeler", showMap: "Afficher la carte", mapNote: "Charge Google Maps", playVideo: "Lire la vidéo", cookieText: "Nous aimerions utiliser des cookies pour comprendre comment les visiteurs utilisent ce site.", accept: "Accepter", reject: "Refuser", privacy: "Politique de confidentialité", cookieSettings: "Paramètres des cookies" },
  de: { choose: "Bitte wählen…", readMore: "Weiterlesen", soldOut: "Ausverkauft", backTo: "Zurück zu", home: "Startseite", noPosts: "Noch keine Beiträge. Schauen Sie bald wieder vorbei!", openMenu: "Menü öffnen", call: "Anrufen", showMap: "Karte anzeigen", mapNote: "Lädt Google Maps", playVideo: "Video abspielen", cookieText: "Wir möchten Cookies verwenden, um zu verstehen, wie Besucher diese Website nutzen.", accept: "Akzeptieren", reject: "Ablehnen", privacy: "Datenschutzerklärung", cookieSettings: "Cookie-Einstellungen" },
  es: { choose: "Elegir…", readMore: "Leer más", soldOut: "Agotado", backTo: "Volver a", home: "Inicio", noPosts: "Aún no hay publicaciones. ¡Vuelve pronto!", openMenu: "Abrir menú", call: "Llamar", showMap: "Mostrar mapa", mapNote: "Carga Google Maps", playVideo: "Reproducir vídeo", cookieText: "Nos gustaría usar cookies para entender cómo se utiliza este sitio web.", accept: "Aceptar", reject: "Rechazar", privacy: "Política de privacidad", cookieSettings: "Configuración de cookies" },
  it: { choose: "Scegli…", readMore: "Leggi di più", soldOut: "Esaurito", backTo: "Torna a", home: "Home", noPosts: "Ancora nessun articolo. Torna presto!", openMenu: "Apri il menu", call: "Chiama", showMap: "Mostra la mappa", mapNote: "Carica Google Maps", playVideo: "Riproduci il video", cookieText: "Vorremmo usare i cookie per capire come i visitatori usano questo sito.", accept: "Accetta", reject: "Rifiuta", privacy: "Informativa sulla privacy", cookieSettings: "Impostazioni cookie" },
  nl: { choose: "Kies…", readMore: "Lees meer", soldOut: "Uitverkocht", backTo: "Terug naar", home: "Home", noPosts: "Nog geen berichten. Kom snel terug!", openMenu: "Menu openen", call: "Bellen", showMap: "Kaart tonen", mapNote: "Laadt Google Maps", playVideo: "Video afspelen", cookieText: "We willen cookies gebruiken om te begrijpen hoe bezoekers deze website gebruiken.", accept: "Accepteren", reject: "Weigeren", privacy: "Privacybeleid", cookieSettings: "Cookie-instellingen" },
  pt: { choose: "Escolher…", readMore: "Ler mais", soldOut: "Esgotado", backTo: "Voltar a", home: "Início", noPosts: "Ainda não há publicações. Volte em breve!", openMenu: "Abrir menu", call: "Ligar", showMap: "Mostrar mapa", mapNote: "Carrega o Google Maps", playVideo: "Reproduzir vídeo", cookieText: "Gostaríamos de usar cookies para perceber como os visitantes usam este site.", accept: "Aceitar", reject: "Recusar", privacy: "Política de privacidade", cookieSettings: "Definições de cookies" },
  pl: { choose: "Wybierz…", readMore: "Czytaj dalej", soldOut: "Wyprzedane", backTo: "Wróć do", home: "Strona główna", noPosts: "Brak wpisów. Zajrzyj wkrótce!", openMenu: "Otwórz menu", call: "Zadzwoń", showMap: "Pokaż mapę", mapNote: "Wczytuje Mapy Google", playVideo: "Odtwórz wideo", cookieText: "Chcielibyśmy używać plików cookie, aby zrozumieć, jak odwiedzający korzystają z tej strony.", accept: "Akceptuję", reject: "Odrzucam", privacy: "Polityka prywatności", cookieSettings: "Ustawienia cookie" },
};

export const words = (lang) => WORDS[lang] || EN;

/** "21 March 2026" in the site's language. */
export function formatDate(iso, lang = "en-GB") {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  try { return d.toLocaleDateString(lang, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); } catch { return d.toISOString().slice(0, 10); }
}
