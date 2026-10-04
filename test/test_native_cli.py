import json, os, pathlib, subprocess, sys, tempfile, unittest
ROOT=pathlib.Path(__file__).resolve().parent.parent

class NativeCLIConfigTests(unittest.TestCase):
    def read(self,home,args):
        return json.loads(subprocess.check_output([sys.executable,str(ROOT/'native-cli-config.py'),json.dumps(args)],env={**os.environ,'CODEX_HOME':str(home)}))
    def test_profile_and_manual_override_preserve_subcommand_and_option_values(self):
        with tempfile.TemporaryDirectory() as directory:
            home=pathlib.Path(directory)
            (home/'config.toml').write_text('model="gpt-jev-auto"\nmodel_provider="jev"\n[profiles.work]\nmodel="gpt-jev-sol"\n')
            result=self.read(home,['-p','work','-m','gpt-6.1-sol','-C','some path','-c','model_reasoning_effort="high"','exec','--output-last-message','out.txt','Synthetic request'])
            self.assertEqual(result['model'],'gpt-6.1-sol');self.assertEqual(result['provider'],'jev')
            self.assertEqual(result['effort'],'high');self.assertEqual(result['command'],'exec');self.assertEqual(result['positional'],['Synthetic request'])
    def test_separate_profile_config_and_foreign_provider_are_resolved(self):
        with tempfile.TemporaryDirectory() as directory:
            home=pathlib.Path(directory);(home/'config.toml').write_text('model="gpt-jev-auto"\n')
            (home/'custom.config.toml').write_text('model="other-model"\nmodel_provider="foreign"\n')
            result=self.read(home,['--profile=custom','resume','--last'])
            self.assertEqual(result['provider'],'foreign');self.assertEqual(result['command'],'resume')
    def test_resume_reads_only_thread_metadata_and_restores_saved_effort(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as directory:
            home=pathlib.Path(directory);(home/'config.toml').write_text('model="gpt-jev-auto"\nmodel_provider="jev"\nmodel_reasoning_effort="medium"\n')
            db=sqlite3.connect(home/'state_5.sqlite');db.execute('CREATE TABLE threads (id TEXT, model TEXT, reasoning_effort TEXT, model_provider TEXT, name TEXT, cwd TEXT, updated_at_ms INTEGER, has_user_event INTEGER)')
            db.execute('INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)',('synthetic-id','gpt-6-luna','high','openai',None,os.getcwd(),1,1));db.commit();db.close()
            result=self.read(home,['exec','resume','synthetic-id','Followup'])
            self.assertEqual(result['savedModel'],'gpt-6-luna');self.assertEqual(result['savedEffort'],'high');self.assertEqual(result['savedProvider'],'openai')
            last=self.read(home,['exec','resume','--last','Followup']);self.assertEqual(last['resumeThread'],'synthetic-id')
            manual=self.read(home,['exec','resume','synthetic-id','-m','gpt-6.1-sol','-c','model_reasoning_effort="low"','Followup'])
            self.assertTrue(manual['explicitModel']);self.assertTrue(manual['explicitEffort']);self.assertEqual(manual['model'],'gpt-6.1-sol')
