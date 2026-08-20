# машинная сверка настроек

всего у monkeytype: 94
всего у нас: 84 (из них done:true — 60, done:false — 24)
только у них: 12 — words, time, minBurstCustomSpeed, customLayoutfluid, customPolyglot, compositionDisplay, paceCaretStyle, repeatedPace, customTheme, customThemeColors, accountChart, monkeyPowerLevel
только у нас: 2 — timeValue, wordsValue
у обоих: 82

## общие ключи: значения и дефолты

| ключ | значения monkeytype | значения наши | дефолт mt | дефолт наш | done |
|---|---|---|---|---|---|
| punctuation | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| numbers | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| mode | (Shared.ModeSchema) | time words quote ⚠️ | "time" | "time" ✅ | да |
| quoteLength | (QuoteLengthConfigSchema) | short medium long thicc all ⚠️ | [1] | "medium" ⚠️ | **нет** |
| language | (LanguageSchema) | (picker) ⚠️ | "english" | "english" ✅ | да |
| burstHeatmap | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| difficulty | (DifficultySchema) | normal expert master ⚠️ | "normal" | "normal" ✅ | да |
| quickRestart | off esc tab enter | off esc tab enter ✅ | "off" | "tab" ⚠️ | да |
| repeatQuotes | off typing | off typing ✅ | "off" | "off" ✅ | **нет** |
| resultSaving | (z.boolean) | (toggle) ⚠️ | true | true ✅ | да |
| blindMode | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| alwaysShowWordsHistory | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| singleListCommandLine | manual on | manual on ✅ | "on" | "manual" ⚠️ | **нет** |
| minWpm | off custom | off custom ✅ | "off" | "off" ✅ | **нет** |
| minWpmCustomSpeed | (MinWpmCustomSpeedSchema) | (number) ⚠️ | 100 | 100 ✅ | **нет** |
| minAcc | off custom | off custom ✅ | "off" | "off" ✅ | **нет** |
| minAccCustom | (MinimumAccuracyCustomSchema) | (number) ⚠️ | 90 | 90 ✅ | **нет** |
| minBurst | off fixed flex | off fixed flex ✅ | "off" | "off" ✅ | **нет** |
| britishEnglish | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| funbox | (FunboxSchema) | (picker) ⚠️ | [] | [] ✅ | да |
| freedomMode | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| strictSpace | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| oppositeShiftMode | off on keymap | off on ⚠️ | "off" | "off" ✅ | **нет** |
| stopOnError | off word letter | off word letter ✅ | "off" | "off" ✅ | да |
| deleteOnError | off letter letter_hard word word_hard | off letter word ⚠️ | "off" | "off" ✅ | **нет** |
| confidenceMode | off on max | off on max ✅ | "off" | "off" ✅ | да |
| quickEnd | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| indicateTypos | off below replace both | off below replace ⚠️ | "off" | "off" ✅ | **нет** |
| hideExtraLetters | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| lazyMode | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| layout | (LayoutSchema) | (picker) ⚠️ | "default" | "qwerty" ⚠️ | да |
| codeUnindentOnBackspace | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| soundVolume | (SoundVolumeSchema) | (number) ⚠️ | 0.5 | 0.3 ⚠️ | да |
| playSoundOnClick (у нас `soundOnClick`) | off 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 | off 1 2 3 4 5 6 7 14 15 16 17 18 19 20 21 22 23 24 25 26 ⚠️ | "off" | "off" ✅ | да |
| playSoundOnError (у нас `soundOnError`) | off 1 2 3 4 | off 1 2 3 4 ✅ | "off" | "off" ✅ | да |
| playTimeWarning | (PlayTimeWarningSchema) | off 1 3 5 10 ⚠️ | "off" | "off" ✅ | **нет** |
| smoothCaret | off slow medium fast | off slow medium fast ✅ | "medium" | "medium" ✅ | да |
| caretStyle | off default block outline underline carrot banana monkey | off line block outline underline ⚠️ | "default" | "line" ⚠️ | да |
| paceCaret | off average pb tagPb last custom daily | off average pb last custom ⚠️ | "off" | "off" ✅ | да |
| paceCaretCustomSpeed | (PaceCaretCustomSpeedSchema) | (number) ⚠️ | 100 | 100 ✅ | да |
| timerStyle | off bar text mini flash_text flash_mini | off bar text mini ⚠️ | "mini" | "text" ⚠️ | да |
| liveSpeedStyle | off text mini | off text mini ✅ | "off" | "text" ⚠️ | да |
| liveAccStyle | off text mini | off text mini ✅ | "off" | "off" ✅ | да |
| liveBurstStyle | off text mini | off text mini ✅ | "off" | "off" ✅ | да |
| timerColor | black sub text main | black sub text main ✅ | "main" | "main" ✅ | да |
| timerOpacity | 0.25 0.5 0.75 1 | 0.25 0.5 0.75 1 ✅ | "1" | "1" ✅ | да |
| highlightMode | off letter word next_word next_two_words next_three_words | off letter word next_word ⚠️ | "letter" | "letter" ✅ | да |
| typedEffect | keep hide fade dots | keep hide fade dots ✅ | "keep" | "keep" ✅ | да |
| tapeMode | off letter word | off letter word ✅ | "off" | "off" ✅ | да |
| tapeMargin | (TapeMarginSchema) | (number) ⚠️ | 50 | 50 ✅ | да |
| smoothLineScroll | (z.boolean) | (toggle) ⚠️ | false | true ⚠️ | да |
| showAllLines | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| alwaysShowDecimalPlaces | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| typingSpeedUnit | wpm cpm wps cps wph | wpm cpm wps cps wph ✅ | "wpm" | "wpm" ✅ | да |
| startGraphsAtZero | (z.boolean) | (toggle) ⚠️ | true | true ✅ | да |
| maxLineWidth | (MaxLineWidthSchema) | (number) ⚠️ | 0 | 0 ✅ | да |
| fontSize | (FontSizeSchema) | (number) ⚠️ | 2 | 1.5 ⚠️ | да |
| fontFamily | (FontNameSchema) | (picker) ⚠️ | "Roboto_Mono" | "Roboto Mono" ⚠️ | да |
| keymapMode | off static react next | off static react next ✅ | "off" | "off" ✅ | да |
| keymapLayout | (KeymapLayoutSchema) | (picker) ⚠️ | "overrideSync" | "qwerty" ⚠️ | да |
| keymapStyle | staggered alice matrix split split_matrix steno steno_matrix | staggered matrix split alice ⚠️ | "staggered" | "staggered" ✅ | да |
| keymapLegendStyle | lowercase uppercase blank dynamic | lowercase uppercase blank dynamic ✅ | "lowercase" | "lowercase" ✅ | да |
| keymapKeys | minimal "minimal_numrow "full | minimal minimal_numrow full ⚠️ | "minimal" | "minimal" ✅ | да |
| keymapSize | (KeymapSizeSchema) | (number) ⚠️ | 1 | 1 ✅ | да |
| flipTestColors | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| colorfulMode | (z.boolean) | (toggle) ⚠️ | false | false ✅ | да |
| customBackground | (CustomBackgroundSchema) | (text) ⚠️ | "" | "" ✅ | да |
| customBackgroundSize | cover contain max | cover contain max ✅ | "cover" | "cover" ✅ | да |
| customBackgroundFilter | (CustomBackgroundFilterSchema) | (text) ⚠️ | [0, 1, 1, 1] | "" ⚠️ | да |
| autoSwitchTheme | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| themeLight | (ThemeNameSchema) | (picker) ⚠️ | "serika" | "serika_light" ⚠️ | **нет** |
| themeDark | (ThemeNameSchema) | (picker) ⚠️ | "serika_dark" | "serika_dark" ✅ | **нет** |
| randomTheme | off on fav light dark custom auto | off on light dark fav ⚠️ | "off" | "off" ✅ | **нет** |
| favThemes | (FavThemesSchema) | (text) ⚠️ | [] | "" ⚠️ | **нет** |
| theme | (ThemeNameSchema) | (picker) ⚠️ | "serika_dark" | "serika_dark" ✅ | да |
| showKeyTips | (z.boolean) | (toggle) ⚠️ | true | true ✅ | да |
| showOutOfFocusWarning | (z.boolean) | (toggle) ⚠️ | true | true ✅ | да |
| capsLockWarning | (z.boolean) | (toggle) ⚠️ | true | true ✅ | да |
| showAverage | off speed acc both | off speed acc both ✅ | "off" | "off" ✅ | **нет** |
| showPb | (ShowPbSchema) | (toggle) ⚠️ | false | true ⚠️ | да |
| monkey | (z.boolean) | (toggle) ⚠️ | false | false ✅ | **нет** |
| ads | off result on sellout | off ⚠️ | "result" | "off" ⚠️ | да |