# CP Helper

Central repository for competitive programming extensions.

| Path | Kind | Purpose |
| --- | --- | --- |
| oj-runner/ | VS Code extension | OJ Runner: runs C++ against imported samples and submits to judges |
| oj-loader/ | Chrome extension | OJ Loader: scrapes judge problem pages, sends samples to OJ Runner, carries out submits |
| cp-picker/ | Chrome extension | CP Picker: picks a random topic to practice each day |

Each folder is self-contained; see its README for build and install steps.

## Build

The root Makefile drives all three extensions (`make help` lists every target).

```sh
make               # build oj-runner/out, oj-loader/dist and cp-picker/dist
make oj-loader     # build a single extension
make typecheck     # type-check every extension
make vsix          # package oj-runner/oj-runner.vsix
make vsix-install  # package and install OJ Runner into $OJ_RUNNER_PROFILE
make bump VERSION=minor
make clean         # remove build output
```

Dependencies are installed on first build; `make install` reinstalls them.

## License

MIT
