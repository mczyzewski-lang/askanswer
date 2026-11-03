-- "Nowy Etap" preset: brand colours (deep green + gold). Themes still on the old preset colours
-- (never customised) take the new ones; themes with colours changed by hand keep them.
UPDATE "Theme"
SET "primaryColor" = '#34524E', "accentColor" = '#B79559', "secondaryColor" = '#FCF9F8',
    "textColor" = '#FFFFFF', "highlightColor" = '#C9A96E', "backgroundColor" = '#263D3A', "updatedAt" = NOW()
WHERE "presetKey" = 'nowy-etap'
  AND upper("primaryColor") = '#1F4E5F' AND upper("accentColor") = '#5FB49C' AND upper("secondaryColor") = '#DCEFE8'
  AND upper("textColor") = '#FFFFFF' AND upper("highlightColor") = '#7BDCB5' AND upper("backgroundColor") = '#10262E';
