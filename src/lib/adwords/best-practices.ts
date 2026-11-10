/**
 * Good practices of ad creatives in 2026 — Google Ads (PMax / Demand Gen) and Meta (Facebook / Instagram),
 * plus law-firm and webinar specifics. Research of 2026-11-10 (web search; "official" = a Google / Meta /
 * LinkedIn page). Shown as a fold-out list above the creatives; each point links its source.
 */
export interface Practice {
  text: string;
  source: string;
  official: boolean;
}
export const PRACTICES_CHECKED_AT = "2026-11-10";
export const PRACTICES: Record<"google" | "meta" | "legal" | "webinar", Practice[]> = {
  "google": [
    {
      "text": "Rób: w każdej grupie zasobów PMax uzupełnij wszystkie typy zasobów (tekst, obrazy, wideo, logo). Rekomendacja Google: 11 nagłówków (maks. 15), 2 długie nagłówki (maks. 5) i 4 teksty reklamy (maks. 5). Co najmniej jeden nagłówek musi mieć do 30 znaków, inaczej siła reklamy spada do „Niekompletna”.",
      "source": "https://support.google.com/google-ads/answer/14528220",
      "official": true
    },
    {
      "text": "Rób: przygotuj obrazy we wszystkich proporcjach: 1,91:1, 1:1 i pionowe 4:5 (960×1200) albo 9:16. Najlepiej po 3 lub więcej na format i bez duplikatów, bo poziom „Doskonała” wymaga różnorodności. Uwaga: progi „3 na format” Google podaje wprost dla Demand Gen.",
      "source": "https://support.google.com/google-ads/answer/13720855?hl=en-GB",
      "official": true
    },
    {
      "text": "Rób: trzymaj kluczową treść w centralnych 80% kadru, zapisuj pliki jako JPG lub PNG do 5 MB, a logo wgrywaj w kwadracie. Nie używaj logo w przeważającej części białego na przezroczystym tle.",
      "source": "https://support.google.com/google-ads/answer/14530211",
      "official": true
    },
    {
      "text": "Unikaj: dużych napisów, przycisków i logo nakładanych na obrazy. System sam dobiera do obrazu teksty z Twoich nagłówków, a dominujący tekst promocyjny może skończyć się odrzuceniem. To zalecenie z poradników zewnętrznych; oficjalna tabela Google dopuszcza nakładki tylko w niektórych przypadkach, więc szczegóły sprawdź na stronie Google. Dlatego dodawaj też wersje bez tekstu (czyste zdjęcia) i z ekspertem.",
      "source": "https://www.crafted.co.uk/getmedia/1c5d5439-5d1e-4d34-91d9-5ee5772ce917/PMAX-Specs-Guide-2026_Crafted_1_2.pdf",
      "official": false
    },
    {
      "text": "Rób: dodaj własne wideo, w tym co najmniej jedno pionowe 9:16 o długości 10–60 s, żeby kwalifikowało się do YouTube Shorts. Dla kampanii nastawionych na konwersję Google sugeruje 10–30 s.",
      "source": "https://support.google.com/google-ads/answer/14528532",
      "official": true
    },
    {
      "text": "Unikaj: zostawiania PMax bez wideo. Google wygeneruje wtedy filmy automatycznie, a według testów zewnętrznych działają one gorzej od własnych (podawane jest 25–40%, ale bez opublikowanej metodologii, więc traktuj to orientacyjnie).",
      "source": "https://adcreate.com/blog/google-performance-max-ai-video-assets",
      "official": false
    },
    {
      "text": "Rób: buduj wideo według ABCD (Attention, Branding, Connection, Direction). Mocne otwarcie, wczesny branding, a CTA powtórz i w lektorze, i w grafice. W Demand Gen łącz wideo z obrazami: Google podaje +6% konwersji na dolara względem samych obrazów.",
      "source": "https://support.google.com/google-ads/answer/14733311?hl=en",
      "official": true
    },
    {
      "text": "Rób: przy pionowych formatach stawiaj na autentyczne, „relatable” wideo. Google raportuje 10–20% więcej konwersji na dolara w Shorts po dodaniu wideo pionowego.",
      "source": "https://blog.google/products/ads-commerce/vertical-video-youtube/",
      "official": true
    },
    {
      "text": "Rób: ustaw wytyczne marki na poziomie kampanii. Nazwa firmy i logo są wymagane, a czcionka (z listy Google Fonts) i kolory główny oraz akcentowy są opcjonalne. Te ustawienia wpływają głównie na autogenerowane wideo YouTube i elastyczne reklamy displayowe. Sprawdź kolory i fonty, które Google AI zaproponuje na podstawie strony docelowej.",
      "source": "https://support.google.com/google-ads/answer/14934472",
      "official": true
    },
    {
      "text": "Rób: obrazy generowane przez AI w Google Ads (Imagen) mogą przedstawiać dorosłe osoby i twarze, w tym ujęcia lifestyle'owe. Każdy obraz trzeba jednak przejrzeć przed użyciem. Nie da się generować dzieci, znanych osób ani rozpoznawalnych wizerunków, a obrazy są oznaczane znakiem SynthID.",
      "source": "https://support.google.com/google-ads/answer/14150602",
      "official": true
    },
    {
      "text": "Rób: oceniaj zasoby w raportach na poziomie zasobu, które od 2025 r. pokazują wyświetlenia, kliknięcia, koszt i konwersje, a od 09.2025 także podział na sieci. Google zaznacza, że wskaźniki takie jak CTR, CPA czy ROAS na poziomie zasobu są tylko kierunkowe, a decyzje lepiej podejmować na poziomie grupy zasobów lub kampanii.",
      "source": "https://ppc.land/google-adds-network-segmentation-to-performance-max-asset-reports/",
      "official": false
    },
    {
      "text": "Rób: wymieniaj słabe zasoby na podstawie raportu kanałów i raportu zasobów (ogłoszone przez Google 30.04.2025). Siła reklamy jest tylko wskaźnikiem kierunkowym: koreluje z wynikami, ale sama ich nie zmienia.",
      "source": "https://blog.google/products/ads-commerce/channel-performance-reporting-coming-to-performance-max/",
      "official": true
    },
    {
      "text": "Rób: zmiany kreacji testuj w eksperymencie A/B zasobów PMax (beta) w obrębie jednej grupy zasobów, zamiast duplikować kampanie. Funkcja nie jest jeszcze dostępna na wszystkich kontach, a zasoby testowe po zakończeniu eksperymentu są usuwane.",
      "source": "https://support.google.com/google-ads/answer/16807329",
      "official": true
    }
  ],
  "meta": [
    {
      "text": "Rób: w ramach jednego zestawu reklam przygotuj kilka różnych koncepcji, np. ekspert do kamery, case/testimonial, FAQ, grafika z liczbą, demo. Andromeda dopasowuje kreacje do odbiorców, więc różnorodność kreacji działa dziś jak targetowanie.",
      "source": "https://pubcast.jonloomer.com/creative-diversification-is-the-new-targeting/",
      "official": false
    },
    {
      "text": "Unikaj: wariantów różniących się tylko kolorem, CTA czy pierwszym zdaniem. Algorytm może traktować je jak tę samą reklamę. Meta nie publikuje progu podobieństwa, więc to interpretacja branży.",
      "source": "https://www.dentsu.com/ae/en/our-latest-thinking/meta-andromeda-strategy",
      "official": false
    },
    {
      "text": "Kontekst: Andromeda to system Meta, który wybiera z dziesiątek milionów reklam kilka tysięcy dopasowanych do użytkownika. Według Meta od 2025 r. dał +2,4% konwersji na Facebooku. Z tego wynika, że im więcej różnych sygnałów w kreacjach, tym więcej szans na dopasowanie.",
      "source": "https://engineering.fb.com/2026/10/28/ml-applications/meta-andromeda-next-gen-ads-retrieval-gpu-co-design/",
      "official": true
    },
    {
      "text": "Rób: stara rekomendacja „maks. 6 reklam na zestaw” zniknęła z wytycznych Meta. Praktycy uruchamiają kilkanaście reklam lub więcej na zestaw (podawane 15–50 to dane niezweryfikowane).",
      "source": "https://www.jonloomer.com/meta-andromeda/",
      "official": false
    },
    {
      "text": "Rób: w feedzie używaj 4:5 (1440×1800) albo 1:1, nie poziomych kadrów. Według Ads Guide dla pojedynczego obrazu tekst główny ma mieć 50–150 znaków, a nagłówek 27. Popularne „125/40” to limity karuzeli i kolekcji, więc kluczowy komunikat zmieść w pierwszych ~125 znakach.",
      "source": "https://www.facebook.com/business/ads-guide/update/image",
      "official": true
    },
    {
      "text": "Rób: Reels i Stories twórz w 9:16 (1440×2560). Zostaw wolne ok. 14% od góry, 35% od dołu i 6% po bokach: bez tekstu, logo i CTA w tych pasach.",
      "source": "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
      "official": true
    },
    {
      "text": "Rób: hook i branding umieść w pierwszych 3 s, np. twarz, pytanie albo konkretna liczba. Według Meta 65% osób, które obejrzą pierwsze 3 s, ogląda co najmniej 10 s (to starsze dane Meta).",
      "source": "https://www.facebook.com/business/news/updated-features-for-video-ads",
      "official": true
    },
    {
      "text": "Rób: projektuj z dźwiękiem (lektor, muzyka), bo według Meta ponad 75% wyświetleń Reels na Instagramie odbywa się z włączonym dźwiękiem. Dodawaj też napisy dla oglądających bez dźwięku. Meta podaje, że wideo 9:16 z dźwiękiem i treścią w strefie bezpiecznej miało o 34,5% niższy koszt wyniku niż obrazy w Reels (źródło z 2024 r.).",
      "source": "https://developers.facebook.com/blog/post/2024/11/07/unlock-the-power-of-reel-ads/",
      "official": true
    },
    {
      "text": "Rób: testuj reklamy partnerskie z twórcami lub ekspertami. W nagłówku widać oba konta, a Meta wykorzystuje sygnały obu do rankingu. Twierdzenia o lepszej skuteczności pochodzą od samej Meta, a niezależnych badań o twarzach w UGC nie znalazłem.",
      "source": "https://developers.secure.facebook.com/blog/post/2025/03/25/instagram-partnership-ads/",
      "official": true
    },
    {
      "text": "Uważaj: ulepszenia Advantage+ creative (rozszerzenie obrazu, poprawki jasności i kontrastu, szablony, rotacja tekstu między nagłówkiem a tekstem głównym) mogą zmienić wygląd i treść reklamy. W branży regulowanej włączaj je świadomie i sprawdzaj podglądy.",
      "source": "https://www.facebook.com/business/help/297506218282224",
      "official": true
    },
    {
      "text": "Rób: tekst na obrazach ogranicz do krótkiego hasła. Meta dalej zaleca mało tekstu na grafice, mimo że reguła 20% formalnie nie obowiązuje.",
      "source": "https://www.facebook.com/business/help/980593475366490?id=1240182842783684",
      "official": true
    },
    {
      "text": "Rób: odświeżaj kreacje na podstawie sygnałów zmęczenia (rosnąca częstotliwość, często podawane >2,5–3, i spadek CTR lub wzrost CPA), a nie według kalendarza. W kampaniach na zimny ruch orientacyjnie co 1–4 tygodnie. Te liczby pochodzą z branży, nie od Meta.",
      "source": "https://segwise.ai/blog/how-often-refresh-ad-creatives.md",
      "official": false
    },
    {
      "text": "Rób: w formularzach lead ads wybieraj typ „Większa intencja” (krok potwierdzenia danych), ogranicz się do 2–3 pytań kwalifikujących i podłącz CRM z szybkim kontaktem. Daj testowi 2–3 tygodnie i mierz odsetek leadów, które zamieniły się w spotkanie.",
      "source": "https://www.ppchero.com/a-walkthrough-guide-to-meta-instant-form-ads",
      "official": false
    }
  ],
  "legal": [
    {
      "text": "Uwaga (PL): adwokatów nadal obowiązuje zakaz reklamy (§23 KEA). Wolno informować o działalności rzetelnie i bez wprowadzania w błąd. Projekt NRA dopuszczający reklamę był konsultowany, ale nie potwierdziłem, czy wszedł w życie. Każdą kampanię zweryfikuj z klientem pod kątem jego samorządu.",
      "source": "https://www.gazetaprawna.pl/prawnik/orzecznictwo/artykuly/10963469,calkowity-zakaz-reklamy-adwokatow-znika-nra.html",
      "official": false
    },
    {
      "text": "Unikaj: zwrotów wartościujących i porównawczych typu „najlepszy”, „najskuteczniejsza kancelaria w Warszawie”. Zakazuje ich etyka radców prawnych.",
      "source": "https://www.rp.pl/prawnicy/art5593331-radca-moze-w-internecie-troche-wiecej-niz-adwokat",
      "official": false
    },
    {
      "text": "Rób: radca prawny może korzystać z marketingu internetowego i social mediów, ale nie anonimowo. Reklama musi jasno wskazywać, kto ją prowadzi (imię i nazwisko, tytuł), i nie może manipulować słowami kluczowymi w wyszukiwarkach (wg broszury OIRP Warszawa z 2026 r.).",
      "source": "https://www.oirpwarszawa.pl/wp-content/uploads/2026/04/broszura-o-zasadach-promocji-oirp-w-warszawie.pdf",
      "official": false
    },
    {
      "text": "Rób: najczęściej polecany format to 30–60-sekundowe wideo, w którym prawnik wyjaśnia prostym językiem częsty problem prawny i kończy CTA. Pierwsze 5 s ma przynieść konkretną wartość, a napisy są obowiązkowe.",
      "source": "https://www.smartsites.com/blog/facebook-advertising-for-lawyers-6-tips-to-attract-more-clients/",
      "official": false
    },
    {
      "text": "Rób: pokazuj prawdziwych prawników kancelarii zamiast zdjęć stockowych (młotek, waga, uścisk dłoni). Autentyczne, nawet telefoniczne nagranie „ekspert do kamery” buduje zaufanie lepiej niż studyjna produkcja. To opinia agencji, nie badanie.",
      "source": "https://webris.org/lawyer-facebook-ad-examples/",
      "official": false
    },
    {
      "text": "Rób: dopasuj treść do etapu lejka. Na zimny ruch edukacyjne wideo eksperta, na remarketing dowody zaufania. W Polsce zamiast testimoniali klientów rozważ tytuły, publikacje i wystąpienia, bo opinie klientów mogą kolidować z zasadami etyki i tajemnicą zawodową.",
      "source": "https://legalpracticemarketing.pages.dev/guides/facebook-ads-law-firms",
      "official": false
    },
    {
      "text": "Rób: pytania w formularzu leadowym musi przejrzeć prawnik. Nie zbieraj w formularzu szczegółów sprawy ani danych wrażliwych, a sam formularz ogranicz do kwalifikacji i zgody na kontakt.",
      "source": "https://www.ppchero.com/a-walkthrough-guide-to-meta-instant-form-ads",
      "official": false
    }
  ],
  "webinar": [
    {
      "text": "Rób: datę, godzinę i słowo „bezpłatny webinar” umieść w samej kreacji (w strefie bezpiecznej) i powtórz w nagłówku. Do tego CTA „Zarejestruj się” lub „Zapisz się”. To praktyka branżowa, nie znalazłem oficjalnego źródła Google ani Meta, więc warto ją przetestować.",
      "source": "https://blog.clickmeeting.com/webinar-ads",
      "official": false
    },
    {
      "text": "Rób: w wideo hook i temat podaj w pierwszych 3 s, a CTA z datą na końcu, w strefie bezpiecznej. Tak Meta zaleca rozkładać hook i CTA w Reels.",
      "source": "https://www.facebook.com/business/ads/facebook-instagram-reels-ads",
      "official": true
    },
    {
      "text": "Rób: przygotuj kilka różnych koncepcji: prelegent mówiący do kamery, lista „3 rzeczy, których się dowiesz”, cytat lub liczba, odliczanie „zostały 3 dni”. W ostatnich dniach przed webinarem podmieniaj kreacje na wersje z odliczaniem.",
      "source": "https://www.growthspreeofficial.com/blogs/meta-ads-webinar-promotion-b2b-saas-2026",
      "official": false
    },
    {
      "text": "Rób: kieruj ruch na prostą stronę rejestracji albo do lead ads z minimalną liczbą pól. Zaplanuj przypomnienia i nagranie dla nieobecnych, żeby podnieść frekwencję.",
      "source": "https://www.getcontrast.io/learn/webinar-promotion",
      "official": false
    }
  ]
};
