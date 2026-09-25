from prebuild.cli import main


def test_running_without_a_stage_prints_usage_and_fails(capsys):
    assert main([]) == 2
    assert "usage: prebuild" in capsys.readouterr().out
