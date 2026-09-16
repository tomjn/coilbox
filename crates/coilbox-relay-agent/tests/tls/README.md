# Test certificates for TURN over TLS

`relay.pem` and `relay.key` are a certificate for `localhost` and `127.0.0.1`, signed by the CA in `ca.pem`. `src/tls.rs` and `src/allocation.rs` use them in tests, and the ignored coturn test hands them to coturn as its TLS certificate. Nothing outside the tests trusts this CA, and the CA's key was thrown away after signing.

Both last until August 2126. They were made with OpenSSL 3.6.4:

```sh
S=$(mktemp -d)
openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout $S/ca.key -out ca.pem -days 36500 -subj "/CN=coilbox relay agent test CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout relay.key -out $S/relay.csr -subj "/CN=localhost"
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n' > $S/relay.ext
openssl x509 -req -in $S/relay.csr -CA ca.pem -CAkey $S/ca.key -CAserial $S/ca.srl -CAcreateserial -out relay.pem -days 36500 -extfile $S/relay.ext
```
