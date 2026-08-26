alter table public.learner_constraints
  add column if not exists display_name text,
  add column if not exists skill_level text not null default 'beginner',
  add column if not exists learning_style text,
  add column if not exists subjects text[] not null default '{}'::text[];

create table if not exists public.calibration_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'in_progress',
  item_ids uuid[] not null default '{}'::uuid[],
  summary jsonb
);

grant select, insert, update, delete on public.calibration_sessions to authenticated;
grant all on public.calibration_sessions to service_role;
alter table public.calibration_sessions enable row level security;
create policy "Users manage own calibration sessions" on public.calibration_sessions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists calibration_sessions_user_idx on public.calibration_sessions(user_id, started_at desc);

alter table public.learner_responses
  add column if not exists session_id uuid references public.calibration_sessions(id) on delete set null,
  add column if not exists attempt integer not null default 1,
  add column if not exists difficulty numeric,
  add column if not exists selected_option_id text;

create index if not exists learner_responses_user_item_idx on public.learner_responses(user_id, item_id);

insert into public.diagnostic_items (skill_node_id, question_text, options, correct_option_id, difficulty)
select n.id, v.q, v.opts::jsonb, v.c, v.d
from (values
('Java Syntax Basics','Which keyword prevents a variable from being reassigned in Java?','[{"id":"a","text":"const"},{"id":"b","text":"final"},{"id":"c","text":"static"},{"id":"d","text":"sealed"}]','b',0.1),
('Java Syntax Basics','What is the result of 7 / 2 when both operands are int?','[{"id":"a","text":"3.5"},{"id":"b","text":"3"},{"id":"c","text":"4"},{"id":"d","text":"Compile error"}]','b',0.3),
('Java Syntax Basics','Which statement about String in Java is true?','[{"id":"a","text":"Strings are mutable"},{"id":"b","text":"Strings are immutable and interned literals are shared"},{"id":"c","text":"== always compares content"},{"id":"d","text":"String is a primitive type"}]','b',0.5),
('Java Syntax Basics','What does the var keyword do in Java 10+?','[{"id":"a","text":"Declares a dynamically typed variable"},{"id":"b","text":"Infers the static type from the initializer"},{"id":"c","text":"Creates a global variable"},{"id":"d","text":"Marks a variable as nullable"}]','b',0.6),
('OOP Design Principles','Which principle says a class should have only one reason to change?','[{"id":"a","text":"Open/Closed"},{"id":"b","text":"Single Responsibility"},{"id":"c","text":"Liskov Substitution"},{"id":"d","text":"Interface Segregation"}]','b',0.2),
('OOP Design Principles','Composition is usually preferred over inheritance because it...','[{"id":"a","text":"Runs faster at the JVM level"},{"id":"b","text":"Avoids tight coupling to a base class implementation"},{"id":"c","text":"Uses less memory"},{"id":"d","text":"Allows multiple inheritance of state"}]','b',0.5),
('OOP Design Principles','Violating the Liskov Substitution Principle typically shows up as...','[{"id":"a","text":"A subclass that throws on an inherited operation"},{"id":"b","text":"A class with too many fields"},{"id":"c","text":"A missing interface"},{"id":"d","text":"An unused import"}]','a',0.75),
('Collections & Generics','Which collection guarantees unique elements with no defined ordering?','[{"id":"a","text":"ArrayList"},{"id":"b","text":"HashSet"},{"id":"c","text":"LinkedList"},{"id":"d","text":"TreeMap"}]','b',0.15),
('Collections & Generics','What is the average time complexity of HashMap.get with a good hash function?','[{"id":"a","text":"O(1)"},{"id":"b","text":"O(log n)"},{"id":"c","text":"O(n)"},{"id":"d","text":"O(n log n)"}]','a',0.35),
('Collections & Generics','What does List<? extends Number> allow?','[{"id":"a","text":"Adding any Number"},{"id":"b","text":"Reading elements as Number but not adding (except null)"},{"id":"c","text":"Adding Integers only"},{"id":"d","text":"Nothing, it is a compile error"}]','b',0.7),
('Collections & Generics','Why does generic type information disappear at runtime in Java?','[{"id":"a","text":"Because of type erasure"},{"id":"b","text":"Because of garbage collection"},{"id":"c","text":"Because of JIT inlining"},{"id":"d","text":"It does not disappear"}]','a',0.6),
('Collections & Generics','Which map keeps its keys in sorted order?','[{"id":"a","text":"HashMap"},{"id":"b","text":"TreeMap"},{"id":"c","text":"LinkedHashMap"},{"id":"d","text":"WeakHashMap"}]','b',0.4),
('Exception Handling','Which of these is a checked exception?','[{"id":"a","text":"IllegalArgumentException"},{"id":"b","text":"IOException"},{"id":"c","text":"NullPointerException"},{"id":"d","text":"ArithmeticException"}]','b',0.2),
('Exception Handling','When does a finally block NOT run?','[{"id":"a","text":"When the try block throws"},{"id":"b","text":"When System.exit is called"},{"id":"c","text":"When the try block returns"},{"id":"d","text":"It always runs"}]','b',0.55),
('Exception Handling','What does try-with-resources require of its resource?','[{"id":"a","text":"It implements AutoCloseable"},{"id":"b","text":"It is final"},{"id":"c","text":"It is a stream"},{"id":"d","text":"It is not null-checked"}]','b',0.45),
('Exception Handling','Catching Exception and logging nothing is bad because...','[{"id":"a","text":"It slows down the JVM"},{"id":"b","text":"It hides failures and makes debugging impossible"},{"id":"c","text":"It breaks compilation"},{"id":"d","text":"It leaks memory"}]','b',0.3),
('Exception Handling','Which is the best practice for a service layer error?','[{"id":"a","text":"Throw a domain-specific exception with context"},{"id":"b","text":"Return null"},{"id":"c","text":"Print the stack trace and continue"},{"id":"d","text":"Throw Throwable"}]','a',0.65),
('Multithreading & Concurrency','What does the synchronized keyword guarantee?','[{"id":"a","text":"Mutual exclusion and visibility of changes"},{"id":"b","text":"Faster execution"},{"id":"c","text":"Thread creation"},{"id":"d","text":"Deadlock prevention"}]','a',0.35),
('Multithreading & Concurrency','What problem does volatile solve?','[{"id":"a","text":"Atomicity of compound operations"},{"id":"b","text":"Visibility of writes across threads"},{"id":"c","text":"Deadlocks"},{"id":"d","text":"Thread starvation"}]','b',0.6),
('Multithreading & Concurrency','Which is the safest way to run background work in a server app?','[{"id":"a","text":"new Thread() per request"},{"id":"b","text":"A bounded ExecutorService thread pool"},{"id":"c","text":"Thread.sleep loops"},{"id":"d","text":"Recursion"}]','b',0.5),
('SQL Fundamentals','Which clause filters rows after aggregation?','[{"id":"a","text":"WHERE"},{"id":"b","text":"HAVING"},{"id":"c","text":"ORDER BY"},{"id":"d","text":"LIMIT"}]','b',0.35),
('SQL Fundamentals','An index on a column primarily improves...','[{"id":"a","text":"Insert speed"},{"id":"b","text":"Lookup and filter speed"},{"id":"c","text":"Disk usage"},{"id":"d","text":"Backup speed"}]','b',0.45),
('SQL Fundamentals','What does a LEFT JOIN return?','[{"id":"a","text":"Only matching rows"},{"id":"b","text":"All left rows plus matches, nulls otherwise"},{"id":"c","text":"All rows from both tables"},{"id":"d","text":"Only non-matching rows"}]','b',0.3),
('SQL Fundamentals','Which property of a transaction guarantees it is all-or-nothing?','[{"id":"a","text":"Atomicity"},{"id":"b","text":"Consistency"},{"id":"c","text":"Isolation"},{"id":"d","text":"Durability"}]','a',0.55),
('JDBC & Database Connectivity','What is the main reason to use PreparedStatement?','[{"id":"a","text":"It prevents SQL injection and allows plan reuse"},{"id":"b","text":"It is shorter to write"},{"id":"c","text":"It auto-creates tables"},{"id":"d","text":"It removes the need for a driver"}]','a',0.3),
('JDBC & Database Connectivity','Why use a connection pool?','[{"id":"a","text":"Connections are expensive to create; pooling reuses them"},{"id":"b","text":"It encrypts traffic"},{"id":"c","text":"It replaces transactions"},{"id":"d","text":"It caches query results"}]','a',0.4),
('JDBC & Database Connectivity','What happens if you never close a JDBC ResultSet or Connection?','[{"id":"a","text":"Nothing, the GC handles it immediately"},{"id":"b","text":"Resources leak and the pool eventually exhausts"},{"id":"c","text":"The query rolls back"},{"id":"d","text":"The driver reconnects"}]','b',0.5),
('JDBC & Database Connectivity','Which call turns off JDBC auto-commit so you can manage a transaction?','[{"id":"a","text":"connection.setAutoCommit(false)"},{"id":"b","text":"connection.beginTransaction()"},{"id":"c","text":"statement.startTx()"},{"id":"d","text":"connection.lock()"}]','a',0.6),
('REST API Design','Which status code should a successful resource creation return?','[{"id":"a","text":"200"},{"id":"b","text":"201"},{"id":"c","text":"204"},{"id":"d","text":"302"}]','b',0.25),
('REST API Design','Which HTTP method is idempotent by specification?','[{"id":"a","text":"POST"},{"id":"b","text":"PUT"},{"id":"c","text":"PATCH"},{"id":"d","text":"CONNECT"}]','b',0.45),
('REST API Design','A well-designed REST URL for one order of a customer looks like...','[{"id":"a","text":"/getOrder?id=5"},{"id":"b","text":"/customers/7/orders/5"},{"id":"c","text":"/orderFetch/5"},{"id":"d","text":"/api/doOrder"}]','b',0.35),
('REST API Design','What does returning 409 Conflict usually mean?','[{"id":"a","text":"The client is unauthenticated"},{"id":"b","text":"The request conflicts with current resource state"},{"id":"c","text":"The server is down"},{"id":"d","text":"The URL is wrong"}]','b',0.65),
('Spring Core (DI/IoC)','What does inversion of control mean in Spring?','[{"id":"a","text":"The container creates and wires dependencies for you"},{"id":"b","text":"Controllers call services directly"},{"id":"c","text":"The database drives the app"},{"id":"d","text":"Threads are inverted"}]','a',0.25),
('Spring Core (DI/IoC)','Which injection style is generally recommended?','[{"id":"a","text":"Field injection"},{"id":"b","text":"Constructor injection"},{"id":"c","text":"Setter injection"},{"id":"d","text":"Static injection"}]','b',0.4),
('Spring Core (DI/IoC)','What is the default bean scope in Spring?','[{"id":"a","text":"prototype"},{"id":"b","text":"singleton"},{"id":"c","text":"request"},{"id":"d","text":"session"}]','b',0.5),
('Spring Core (DI/IoC)','Which annotation marks a class as a Spring-managed service bean?','[{"id":"a","text":"@Service"},{"id":"b","text":"@Entity"},{"id":"c","text":"@Table"},{"id":"d","text":"@Override"}]','a',0.15),
('Spring Core (DI/IoC)','Why can @Transactional silently not apply to a self-invoked method?','[{"id":"a","text":"Because proxies only intercept external calls"},{"id":"b","text":"Because it needs a static method"},{"id":"c","text":"Because transactions are disabled by default"},{"id":"d","text":"Because of type erasure"}]','a',0.85),
('Spring Boot','What does spring-boot-starter-web mainly bring in?','[{"id":"a","text":"An embedded server and Spring MVC"},{"id":"b","text":"A database driver"},{"id":"c","text":"A message broker"},{"id":"d","text":"A build tool"}]','a',0.3),
('Spring Boot','Where do you put environment-specific configuration in Spring Boot?','[{"id":"a","text":"application-{profile}.yml"},{"id":"b","text":"pom.xml"},{"id":"c","text":"Dockerfile"},{"id":"d","text":"index.html"}]','a',0.4),
('Spring Boot','What does @SpringBootApplication combine?','[{"id":"a","text":"@Configuration, @EnableAutoConfiguration, @ComponentScan"},{"id":"b","text":"@Controller and @Service"},{"id":"c","text":"@Entity and @Repository"},{"id":"d","text":"@Bean and @Value"}]','a',0.55),
('Spring Boot','Which module exposes health and metrics endpoints?','[{"id":"a","text":"Actuator"},{"id":"b","text":"Data JPA"},{"id":"c","text":"Validation"},{"id":"d","text":"Thymeleaf"}]','a',0.5),
('Spring Security & Auth (JWT)','What is stored in the payload of a JWT?','[{"id":"a","text":"Claims about the user, base64url encoded"},{"id":"b","text":"An encrypted password"},{"id":"c","text":"The server private key"},{"id":"d","text":"The database row id only"}]','a',0.35),
('Spring Security & Auth (JWT)','Why should a JWT never store sensitive secrets?','[{"id":"a","text":"It is signed but not encrypted, so it is readable"},{"id":"b","text":"It is too small"},{"id":"c","text":"It expires too quickly"},{"id":"d","text":"It is compressed"}]','a',0.5),
('Spring Security & Auth (JWT)','What is the correct way to store user passwords?','[{"id":"a","text":"Hash with a slow adaptive algorithm like bcrypt"},{"id":"b","text":"Encrypt with AES"},{"id":"c","text":"Store base64 encoded"},{"id":"d","text":"Store in plain text behind a firewall"}]','a',0.3),
('Spring Security & Auth (JWT)','What is the role of a refresh token?','[{"id":"a","text":"Obtain a new short-lived access token without re-login"},{"id":"b","text":"Encrypt the access token"},{"id":"c","text":"Store user roles"},{"id":"d","text":"Replace HTTPS"}]','a',0.6),
('Spring Security & Auth (JWT)','Difference between authentication and authorization?','[{"id":"a","text":"Who you are vs what you may do"},{"id":"b","text":"They are the same"},{"id":"c","text":"Login vs logout"},{"id":"d","text":"Client vs server"}]','a',0.2),
('Testing (JUnit/Mockito)','What does a unit test primarily verify?','[{"id":"a","text":"One unit of behaviour in isolation"},{"id":"b","text":"The whole deployed system"},{"id":"c","text":"Database performance"},{"id":"d","text":"UI layout"}]','a',0.2),
('Testing (JUnit/Mockito)','What is a Mockito mock used for?','[{"id":"a","text":"Replacing a collaborator with controlled behaviour"},{"id":"b","text":"Speeding up the JVM"},{"id":"c","text":"Generating test data files"},{"id":"d","text":"Compiling test code"}]','a',0.35),
('Testing (JUnit/Mockito)','Which JUnit 5 annotation runs a method before each test?','[{"id":"a","text":"@BeforeEach"},{"id":"b","text":"@Before"},{"id":"c","text":"@Setup"},{"id":"d","text":"@Init"}]','a',0.3),
('Testing (JUnit/Mockito)','A test that fails intermittently without code changes is called...','[{"id":"a","text":"A flaky test"},{"id":"b","text":"An integration test"},{"id":"c","text":"A smoke test"},{"id":"d","text":"A golden test"}]','a',0.55),
('Testing (JUnit/Mockito)','Why prefer testing behaviour over implementation details?','[{"id":"a","text":"Tests stay valid when internals are refactored"},{"id":"b","text":"It runs faster"},{"id":"c","text":"It needs fewer imports"},{"id":"d","text":"It increases coverage automatically"}]','a',0.7),
('Git & Version Control','Which command creates a new branch and switches to it?','[{"id":"a","text":"git checkout -b feature"},{"id":"b","text":"git branch --switch feature"},{"id":"c","text":"git new feature"},{"id":"d","text":"git clone feature"}]','a',0.15),
('Git & Version Control','What does git rebase do compared to git merge?','[{"id":"a","text":"Replays commits onto a new base for linear history"},{"id":"b","text":"Deletes the branch"},{"id":"c","text":"Creates a merge commit"},{"id":"d","text":"Pushes to remote"}]','a',0.6),
('Git & Version Control','What is in the staging area?','[{"id":"a","text":"Changes marked to be included in the next commit"},{"id":"b","text":"Remote commits"},{"id":"c","text":"Stashed work"},{"id":"d","text":"Ignored files"}]','a',0.3),
('Git & Version Control','Which command safely undoes a pushed commit on a shared branch?','[{"id":"a","text":"git revert"},{"id":"b","text":"git reset --hard"},{"id":"c","text":"git clean -fd"},{"id":"d","text":"git rm"}]','a',0.55),
('Linux CLI Basics','Which command shows the contents of a directory?','[{"id":"a","text":"ls"},{"id":"b","text":"cd"},{"id":"c","text":"pwd"},{"id":"d","text":"mv"}]','a',0.1),
('Linux CLI Basics','What does chmod 644 file grant?','[{"id":"a","text":"Owner read/write, others read only"},{"id":"b","text":"Everyone full access"},{"id":"c","text":"Owner execute only"},{"id":"d","text":"No access at all"}]','a',0.5),
('Linux CLI Basics','Which command searches text inside files recursively?','[{"id":"a","text":"grep -r"},{"id":"b","text":"find -text"},{"id":"c","text":"cat -s"},{"id":"d","text":"echo -r"}]','a',0.3),
('Linux CLI Basics','What does the pipe operator do in `cmd1 | cmd2`?','[{"id":"a","text":"Sends stdout of cmd1 to stdin of cmd2"},{"id":"b","text":"Runs both in parallel independently"},{"id":"c","text":"Writes cmd1 output to a file"},{"id":"d","text":"Runs cmd2 only if cmd1 fails"}]','a',0.4),
('Docker Basics','What is a Docker image?','[{"id":"a","text":"An immutable template used to create containers"},{"id":"b","text":"A running process"},{"id":"c","text":"A virtual machine"},{"id":"d","text":"A network bridge"}]','a',0.2),
('Docker Basics','Which Dockerfile instruction sets the command run at container start?','[{"id":"a","text":"CMD"},{"id":"b","text":"RUN"},{"id":"c","text":"COPY"},{"id":"d","text":"FROM"}]','a',0.35),
('Docker Basics','Why use a multi-stage Dockerfile for a Java service?','[{"id":"a","text":"Build with the JDK, ship only the JRE and jar"},{"id":"b","text":"To run multiple containers"},{"id":"c","text":"To enable networking"},{"id":"d","text":"To avoid writing a CMD"}]','a',0.6),
('Docker Basics','How should secrets be provided to a container?','[{"id":"a","text":"Environment variables or a secret store at runtime"},{"id":"b","text":"Hardcoded in the Dockerfile"},{"id":"c","text":"Committed to the image layer"},{"id":"d","text":"In the image tag"}]','a',0.45)
) as v(node, q, opts, c, d)
join public.skill_nodes n on n.name = v.node and n.domain = 'java_backend'
where not exists (
  select 1 from public.diagnostic_items di where di.skill_node_id = n.id and di.question_text = v.q
);