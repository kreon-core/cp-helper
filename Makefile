EXTENSIONS := oj-runner oj-loader cp-picker
NPM ?= npm

.PHONY: all help install build typecheck clean distclean vsix vsix-install \
	$(EXTENSIONS) $(addprefix install-,$(EXTENSIONS)) $(addprefix typecheck-,$(EXTENSIONS)) \
	$(addprefix bump-,$(EXTENSIONS))

all: build

help:
	@echo "Targets:"
	@echo "  build (default)   build all extensions"
	@echo "  oj-runner         compile the VS Code extension into oj-runner/out"
	@echo "  oj-loader         build the Chrome extension into oj-loader/dist"
	@echo "  cp-picker         build the Chrome extension into cp-picker/dist"
	@echo "  install           npm install in every extension"
	@echo "  typecheck         type-check every extension"
	@echo "  vsix              package oj-runner/oj-runner.vsix"
	@echo "  vsix-install      package and install OJ Runner (OJ_RUNNER_PROFILE selects the profile)"
	@echo "  bump-oj-runner    bump OJ Runner and OJ Loader together [VERSION=minor|major|x.y.z]"
	@echo "  bump-oj-loader    same as bump-oj-runner (the two share one version)"
	@echo "  bump-cp-picker    bump CP Picker [VERSION=minor|major|x.y.z]"
	@echo "  clean             remove build output"
	@echo "  distclean         clean and remove node_modules"

install: $(addprefix install-,$(EXTENSIONS))

$(addprefix install-,$(EXTENSIONS)): install-%:
	cd $* && $(NPM) install

%/node_modules: %/package.json
	cd $* && $(NPM) install
	@touch $@

build: $(EXTENSIONS)

oj-runner: oj-runner/node_modules
	cd oj-runner && $(NPM) run compile

oj-loader: oj-loader/node_modules
	cd oj-loader && $(NPM) run build

cp-picker: cp-picker/node_modules
	cd cp-picker && $(NPM) run build

typecheck: $(addprefix typecheck-,$(EXTENSIONS))

typecheck-oj-runner: oj-runner/node_modules
	cd oj-runner && npx tsc --noEmit -p ./

typecheck-oj-loader: oj-loader/node_modules
	cd oj-loader && $(NPM) run typecheck

typecheck-cp-picker: cp-picker/node_modules
	cd cp-picker && $(NPM) run typecheck

vsix: oj-runner/node_modules
	cd oj-runner && $(NPM) run vsix

vsix-install: oj-runner/node_modules
	cd oj-runner && $(NPM) run vsix:local:run

bump-oj-runner: oj-runner/node_modules
	cd oj-runner && $(NPM) run bump $(if $(VERSION),-- $(VERSION))

bump-oj-loader: oj-loader/node_modules
	cd oj-loader && $(NPM) run bump $(if $(VERSION),-- $(VERSION))

bump-cp-picker: cp-picker/node_modules
	cd cp-picker && $(NPM) run bump $(if $(VERSION),-- $(VERSION))

clean:
	rm -rf oj-runner/out oj-runner/*.vsix oj-loader/dist cp-picker/dist

distclean: clean
	rm -rf $(addsuffix /node_modules,$(EXTENSIONS))
