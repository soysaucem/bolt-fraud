.PHONY: install build test typecheck lint clean generate-keys

install:
	npm install

build:
	npm run build --workspaces

test:
	npm run test --workspaces

test-client:
	npm run test -w packages/client

test-server:
	npm run test -w packages/server

typecheck:
	npm run typecheck --workspaces

lint:
	npm run lint --workspaces

clean:
	rm -rf packages/*/dist packages/*/.tsbuildinfo

generate-keys:
	mkdir -p keys
	openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
	openssl rsa -pubout -in keys/private.pem -out keys/public.pem
	@echo "RSA key pair generated in keys/"
