.PHONY: test

all: test 

deps:
	npm install

compile: deps
	npm run lint

test: compile
	npm run build
	
sam-local:
	@echo "Invoking Lambda locally."
	@./local/run-sam.sh 

clean:
	rm -rf node_modules
	rm -rf target
	rm -rf package-lock.json