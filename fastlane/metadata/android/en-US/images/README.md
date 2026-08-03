# Store listing images

Empty, and that is the problem. F-Droid and Play both read this directory, and an entry with no
screenshots is the one nobody installs. F-Droid renders the listing straight from these files, so
whatever is here is what a stranger sees before deciding.

## What goes where

Both stores use the same layout, so one set of files serves both.

```
images/
  icon.png                    512 x 512, PNG, no transparency
  featureGraphic.png          1024 x 500, PNG or JPEG
  phoneScreenshots/           1.png, 2.png, ... in the order they should appear
  sevenInchScreenshots/       optional, tablets
  tenInchScreenshots/         optional, tablets
  tvScreenshots/              optional, and worth having since the app runs on Android TV
```

Screenshots must be PNG or JPEG. F-Droid takes them at the device's own resolution; nothing needs
scaling. The filename decides the order, so name them `1.png` upward rather than by content.

## How many, and of what

Play requires at least two. Four to six is the useful range: past that, nobody scrolls.

The ones worth taking, in this order, because the first two are all most people see:

1. The player with a real album on it. This is the whole app in one image.
2. The locker, populated. It has to look like a library rather than an empty state.
3. Audiobooks or documents mid-narration, which is the thing nothing else here does.
4. Insights, because a private listening history is a reason to choose this over the alternative.
5. Casting or the queue, if either photographs well.

Use a real library. Screenshots of placeholder content read as a demo, and reviewers notice.

## Taking them

The repo already drives a device over adb for its end-to-end tests; the same route takes clean
screenshots:

```
adb exec-out screencap -p > phoneScreenshots/1.png
```

Turn off the status bar clock and notifications first, or every screenshot is timestamped with the
afternoon it was taken.

## What is not acceptable

Not mockups, not renders of the app inside a phone frame, and not screenshots with someone's real
library metadata in them if that is not wanted in public. Both stores reject images that
misrepresent the app, and F-Droid's reviewers read the listing properly.
